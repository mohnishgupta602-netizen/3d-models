import requests

import json
import concurrent.futures
import os
import re
from cache import QueryCache
from fallback import build_fallback_payload

CACHE_VERSION = "v28"
HIGH_SIMILARITY_THRESHOLD = 85

class ModelSearchEngine:
    def __init__(self):
        # We can configure keys for Sketchfab, PolyHaven, etc.
        self.sketchfab_token = os.getenv("SKETCHFAB_API_TOKEN")
        self.tripo3d_token = os.getenv("TRIPO3D_API_KEY")
        self.backend_base_url = os.getenv("BACKEND_BASE_URL") or "http://127.0.0.1:8000"
        self.concept2_backend_url = (os.getenv("CONCEPT2D_BACKEND_URL") or "").strip().rstrip("/")
        self.models_dir = os.path.join(os.path.dirname(__file__), "models")
        self.cache = QueryCache()

    def _location_to_position(self, location: str, index: int, total_parts: int):
        location_text = (location or "").lower()
        spacing = 1.2
        center_offset = (total_parts - 1) / 2.0
        default_x = (index - center_offset) * spacing
        x = default_x
        y = 0.0
        z = 0.0

        if "left" in location_text:
            x = -1.6
        elif "right" in location_text:
            x = 1.6

        if "top" in location_text or "upper" in location_text:
            y = 1.2
        elif "bottom" in location_text or "lower" in location_text or "base" in location_text:
            y = -1.2

        if "front" in location_text:
            z = 1.1
        elif "back" in location_text or "rear" in location_text:
            z = -1.1

        return {"x": round(x, 3), "y": round(y, 3), "z": round(z, 3)}

    def _convert_external_part_labels(self, labels_payload: dict):
        if not isinstance(labels_payload, dict):
            return []

        parts = labels_payload.get("parts")
        if not isinstance(parts, list):
            return []

        converted = []
        total = len(parts)
        for idx, part in enumerate(parts):
            if not isinstance(part, dict):
                continue

            name = (part.get("name") or f"part_{idx + 1}").strip() or f"part_{idx + 1}"
            description = (part.get("description") or "").strip()
            function = (part.get("function") or "").strip()
            location = (part.get("location") or "center").strip()

            if function and description:
                full_description = f"{description} Function: {function}."
            else:
                full_description = description or function or f"Labeled part: {name}"

            primitive = "sphere"
            lowered_name = name.lower()
            if "wheel" in lowered_name:
                primitive = "cylinder"
            elif "body" in lowered_name or "base" in lowered_name or "frame" in lowered_name:
                primitive = "cube"

            converted.append(
                {
                    "name": name,
                    "primitive": primitive,
                    "description": full_description,
                    "position": self._location_to_position(location, idx, max(total, 1)),
                    "parameters": {},
                }
            )

        return converted

    def _fetch_concept2_labeled_model(self, normalized_keywords: str, base_score: float = 81.0):
        if not self.concept2_backend_url:
            return None

        url = f"{self.concept2_backend_url}/visualize"
        try:
            response = requests.get(url, params={"concept": normalized_keywords}, timeout=25)
            if response.status_code != 200:
                return None

            payload_raw = response.json()
            payload = payload_raw if isinstance(payload_raw, dict) else {}
            metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            model_data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
            model_url = payload.get("model_url") or model_data.get("viewer")

            if not model_url:
                return None

            labels_payload = payload.get("part_labels")
            if not isinstance(labels_payload, dict):
                labels_payload = model_data.get("part_labels") if isinstance(model_data.get("part_labels"), dict) else {}

            part_definitions = self._convert_external_part_labels(labels_payload)
            title = (
                (metadata.get("name") if isinstance(metadata, dict) else None)
                or model_data.get("name")
                or normalized_keywords.title()
            )
            description = (
                (metadata.get("description") if isinstance(metadata, dict) else None)
                or model_data.get("description")
                or f"External hybrid model + labels for '{normalized_keywords}'."
            )

            return {
                "source": "Original 3D Labeling Test",
                "title": f"Original + Labels: {title}",
                "uid": f"original-labeled-{normalized_keywords.replace(' ', '-')}",
                "thumbnails": [],
                "model_url": model_url,
                "embed_url": None,
                "score": float(base_score),
                "explanation": description,
                "labeling_mode": "original-3d-test",
                "labeling_preview_note": "Labels imported from Concept-2-3D pipeline output.",
                "built_in_annotations": [],
                "built_in_annotations_count": len(part_definitions),
                "procedural_data": {
                    "components": [pd.get("primitive", "sphere") for pd in part_definitions],
                    "parts": part_definitions,
                },
                "part_definitions": part_definitions,
                "geometry_details": {
                    "concept": normalized_keywords,
                    "total_parts": len(part_definitions),
                    "shapes": part_definitions,
                },
            }
        except Exception:
            return None

    def _build_similarity_labels(self, model: dict):
        score = float(model.get("score") or 0)
        is_3d = bool(model.get("model_url") or model.get("embed_url"))
        if not is_3d or score < HIGH_SIMILARITY_THRESHOLD:
            return None

        if score >= 95:
            tier = "Top Match"
        elif score >= 90:
            tier = "High Match"
        else:
            tier = "Strong Match"

        labels = [
            {"key": "tier", "value": tier},
            {"key": "similarity", "value": f"{int(round(score))}%"},
            {"key": "source", "value": model.get("source", "Unknown")},
        ]

        explanation = (model.get("explanation") or "").strip()
        if explanation:
            labels.append({"key": "reason", "value": explanation})

        return {
            "high_similarity": True,
            "threshold": HIGH_SIMILARITY_THRESHOLD,
            "labels": labels,
        }

    def _score_tier(self, score: float):
        if score >= 95:
            return "elite"
        if score >= 90:
            return "high"
        if score >= 80:
            return "good"
        if score >= 70:
            return "moderate"
        return "low"

    def _build_model_labels(self, model: dict):
        score = float(model.get("score") or 0)
        is_embed = bool(model.get("embed_url"))
        is_model_file = bool(model.get("model_url"))
        has_procedural = bool(model.get("procedural_data"))

        if has_procedural:
            model_type = "procedural-3d"
        elif is_model_file:
            model_type = "native-3d"
        elif is_embed:
            model_type = "embedded-3d"
        else:
            model_type = "other"

        provenance = "fallback" if "fallback" in (model.get("source", "").lower()) else "retrieved"

        labels = [
            {"key": "type", "value": model_type},
            {"key": "tier", "value": self._score_tier(score)},
            {"key": "similarity", "value": f"{int(round(score))}%"},
            {"key": "source", "value": model.get("source", "Unknown")},
            {"key": "provenance", "value": provenance},
        ]

        annotation_count = int(model.get("built_in_annotations_count") or 0)
        if annotation_count > 0:
            labels.append({"key": "annotations", "value": str(annotation_count)})

        return labels

    def _build_original_model_labeling_test(self, model: dict):
        has_procedural = bool(model.get("procedural_data"))
        is_embed = bool(model.get("embed_url"))
        is_model_file = bool(model.get("model_url"))

        # This test section is only for original retrieved 3D outputs.
        if has_procedural or not (is_embed or is_model_file):
            return None

        score = float(model.get("score") or 0)
        title = (model.get("title") or "").strip()
        explanation = (model.get("explanation") or "").strip()

        model_type = "Embedded 3D" if is_embed else "Native 3D"

        inferred_tokens = []
        for token in re.findall(r"[a-z0-9]+", title.lower()):
            if len(token) < 4:
                continue
            if token in {"model", "scene", "asset", "object", "from", "with"}:
                continue
            if token not in inferred_tokens:
                inferred_tokens.append(token)
            if len(inferred_tokens) >= 4:
                break

        labels = [
            {"label": "Model Type", "value": model_type},
            {"label": "Source", "value": model.get("source", "Unknown")},
            {"label": "Similarity", "value": f"{int(round(score))}%"},
            {"label": "Tier", "value": self._score_tier(score).title()},
        ]

        if inferred_tokens:
            labels.append({"label": "Inferred Tags", "value": ", ".join(inferred_tokens)})

        if explanation:
            labels.append({"label": "Match Reason", "value": explanation})

        return {
            "enabled": True,
            "section_title": "Original 3D Labeling (Test)",
            "labels": labels,
        }

    def _normalize_query(self, keywords: str) -> str:
        if not keywords:
            return keywords

        normalized = keywords.lower().strip()

        # Correct high-impact common typo variants so fallback/media lookup stays relevant.
        aliases = {
            "zina virus": "zika virus",
            "zina": "zika",
            "corona virus": "coronavirus",
            "shah ruk khan": "shah rukh khan",
        }
        if normalized in aliases:
            return aliases[normalized]

        tokens = re.findall(r"[a-z0-9]+", normalized)
        mapped = []
        token_map = {
            "zina": "zika",
            "corona": "coronavirus",
            "ruk": "rukh",
        }
        for token in tokens:
            mapped.append(token_map.get(token, token))
        return " ".join(mapped)

    def _build_labeled_breakdown_model(self, normalized_keywords: str, base_score: float = 82.0):
        fallback_payload = build_fallback_payload(normalized_keywords)
        geometry_details = (fallback_payload or {}).get("geometry_details") or {}
        parts = geometry_details.get("shapes") or []

        if not parts:
            parts = [
                {
                    "name": "part_1",
                    "primitive": "cube",
                    "parameters": {"width": 1.2, "height": 1.0, "depth": 1.0},
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "description": f"Core conceptual block for {normalized_keywords}",
                }
            ]

        part_definitions = [
            {
                "name": p.get("name") or f"part_{idx + 1}",
                "primitive": p.get("primitive") or "cube",
                "description": p.get("description") or f"Structural part {idx + 1}",
                "position": p.get("position") or {"x": 0.0, "y": 0.0, "z": 0.0},
                "parameters": p.get("parameters") or {},
            }
            for idx, p in enumerate(parts)
            if isinstance(p, dict)
        ]

        return {
            "source": "Labeled 3D Breakdown",
            "title": f"Labeled Breakdown: {normalized_keywords.title()}",
            "uid": f"labeled-breakdown-{normalized_keywords.replace(' ', '-')}",
            "thumbnails": [],
            "model_url": None,
            "score": float(base_score),
            "explanation": f"Procedural 3D breakdown with labeled parts for '{normalized_keywords}'.",
            "procedural_data": {
                "components": [pd["primitive"] for pd in part_definitions],
                "parts": part_definitions,
            },
            "part_definitions": part_definitions,
            "geometry_details": {
                "concept": normalized_keywords,
                "total_parts": len(part_definitions),
                "shapes": part_definitions,
            },
        }

    def _build_original_labeled_test_card(self, normalized_keywords: str, base_model: dict, base_score: float = 81.0):
        external_card = self._fetch_concept2_labeled_model(normalized_keywords, base_score=base_score)
        if external_card:
            return external_card

        fallback_payload = build_fallback_payload(normalized_keywords)
        geometry_details = (fallback_payload or {}).get("geometry_details") or {}
        parts = geometry_details.get("shapes") or []

        sketchfab_annotations = []
        if (base_model.get("source") or "").lower() == "sketchfab":
            sketchfab_annotations = self._fetch_sketchfab_annotations(base_model.get("uid"))

        part_definitions = [
            {
                "name": p.get("name") or f"part_{idx + 1}",
                "primitive": p.get("primitive") or "cube",
                "description": p.get("description") or f"Label part {idx + 1}",
                "position": p.get("position") or {"x": 0.0, "y": 0.0, "z": 0.0},
                "parameters": p.get("parameters") or {},
            }
            for idx, p in enumerate(parts)
            if isinstance(p, dict)
        ]

        title = (base_model.get("title") or normalized_keywords.title()).strip()
        return {
            "source": "Original 3D Labeling Test",
            "title": f"Original + Labels: {title}",
            "uid": f"original-labeled-{normalized_keywords.replace(' ', '-')}",
            "thumbnails": base_model.get("thumbnails") or [],
            "model_url": base_model.get("model_url"),
            "embed_url": base_model.get("embed_url"),
            "score": float(base_score),
            "explanation": f"Original 3D model with test labels inferred from '{normalized_keywords}'.",
            "labeling_mode": "original-3d-test",
            "labeling_preview_note": "Proxy label view is used when source model is embedded.",
            "built_in_annotations": sketchfab_annotations,
            "built_in_annotations_count": len(sketchfab_annotations),
            "procedural_data": {
                "components": [pd.get("primitive", "cube") for pd in part_definitions],
                "parts": part_definitions,
            },
            "part_definitions": part_definitions,
            "geometry_details": {
                "concept": normalized_keywords,
                "total_parts": len(part_definitions),
                "shapes": part_definitions,
            },
        }

    def _fetch_sketchfab_annotations(self, uid: str):
        if not uid or not self.sketchfab_token:
            return []

        url = f"https://api.sketchfab.com/v3/models/{uid}/annotations"
        headers = {"Authorization": f"Token {self.sketchfab_token}"}

        try:
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code != 200:
                return []

            payload = response.json() or {}
            rows = payload.get("results") if isinstance(payload, dict) else []
            if not isinstance(rows, list):
                return []

            annotations = []
            for idx, row in enumerate(rows):
                if not isinstance(row, dict):
                    continue
                title = (row.get("name") or row.get("title") or f"Annotation {idx + 1}").strip()
                content = (row.get("content") or row.get("description") or "").strip()
                annotations.append({"index": idx + 1, "title": title, "content": content})
            return annotations
        except Exception:
            return []

    def search(self, intent_data: dict) -> list:
        """
        Queries various APIs based on the extracted intent.
        """
        keywords_list = intent_data.get("primary_keywords", [])
        keywords = " ".join(keywords_list)
        normalized_keywords = self._normalize_query(keywords)
        cache_key = f"{CACHE_VERSION}::{normalized_keywords}"
        
        # Check cache first
        cached_results = self.cache.get_cached_results(cache_key)
        if cached_results:
            print(f"Returning cached results for: {normalized_keywords}")
            return cached_results
            
        import concurrent.futures
        
        results = []
        
        # Parallelize API Calls
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            normalized_list = normalized_keywords.split()
            future_tripo = executor.submit(self._generate_tripo3d, normalized_keywords)
            future_sketchfab = executor.submit(self._search_sketchfab, normalized_keywords)
            future_polyhaven = executor.submit(self._search_polyhaven, normalized_list)
            
            # Wait for 3D results
            tripo_results = future_tripo.result()
            sketchfab_results = future_sketchfab.result()
            polyhaven_results = future_polyhaven.result()

        if tripo_results:
            results.extend(tripo_results)
        if sketchfab_results:
            results.extend(sketchfab_results)
        if polyhaven_results:
            results.extend(polyhaven_results)
            
        # If no real 3D models found, add procedural 3D fallback
        if not results:
            print(f"No 3D models found for '{normalized_keywords}', generating procedural 3D fallback.")
            fallback_payload = build_fallback_payload(normalized_keywords)
            geometry_details = (fallback_payload or {}).get("geometry_details") or {}
            parts = geometry_details.get("shapes") or []
            components = [
                p.get("primitive")
                for p in parts
                if isinstance(p, dict) and isinstance(p.get("primitive"), str)
            ]

            results.append({
                "source": "Procedural 3D Fallback",
                "title": f"Procedural Concept: {normalized_keywords.title()}",
                "uid": f"fallback-3d-{normalized_keywords.replace(' ', '-')}",
                "thumbnails": [],
                "model_url": None,
                "score": 84,
                "explanation": f"No exact 3D model was found for '{normalized_keywords}'. Showing an approximate procedural 3D structure.",
                "procedural_data": {
                    "components": components or ["cube"],
                    "parts": parts,
                },
                "geometry_details": geometry_details,
            })

        # Add one extra model in the list: labeled conceptual 3D breakdown with part definitions.
        if results:
            top_score = float(results[0].get("score") or 82)
            breakdown_score = max(60.0, min(86.0, top_score - 3.0))
            results.append(self._build_labeled_breakdown_model(normalized_keywords, base_score=breakdown_score))

            # Add a separate card for original-model labeling test, similar to labeled breakdown card.
            primary_retrieved = next(
                (
                    model
                    for model in results
                    if not model.get("procedural_data") and model.get("model_url")
                ),
                None,
            ) or next(
                (
                    model
                    for model in results
                    if not model.get("procedural_data") and model.get("embed_url")
                ),
                None,
            )
            if primary_retrieved:
                original_test_score = max(58.0, min(85.0, top_score - 4.0))
                results.append(
                    self._build_original_labeled_test_card(
                        normalized_keywords,
                        primary_retrieved,
                        base_score=original_test_score,
                    )
                )

        # Sort results by score (descending)
        results.sort(key=lambda x: x.get("score", 0), reverse=True)

        # Add detailed labels on top similarity 3D results.
        for model in results:
            model["model_labels"] = self._build_model_labels(model)
            metadata = self._build_similarity_labels(model)
            if metadata:
                model["similarity_metadata"] = metadata
            original_labeling = self._build_original_model_labeling_test(model)
            if original_labeling:
                model["original_model_labeling_test"] = original_labeling
        
        # Save to cache before returning
        self.cache.cache_results(cache_key, results)
        
        return results

    def _generate_2d_image(self, keywords: str) -> dict:
        """
        Uses Gemini to generate a descriptive prompt and returns a 2D image URL.
        """
        import google.generativeai as genai
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return None
            
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            prompt = f"Create a highly descriptive, artistic prompt for an image of '{keywords}'. Return ONLY the prompt text."
            response = model.generate_content(prompt)
            img_prompt = response.text.strip().replace(" ", "%20")
            
            # Use Pollinations AI for free image generation
            image_url = f"https://image.pollinations.ai/prompt/{img_prompt}?width=1024&height=1024&nologo=true"
            
            return {
                "source": "Gemini 2D AI",
                "title": f"2D Concept: {keywords.title()}",
                "uid": f"2d-{hash(keywords)}",
                "thumbnails": [{"url": image_url}],
                "image_url": image_url, # Special field for 2D
                "model_url": None,
                "score": 80,
                "explanation": f"AI-generated 2D visualization of '{keywords}' since no suitable 3D models were found."
            }
        except Exception as e:
            print(f"2D Fallback failed: {e}")
            return None

    def _search_polyhaven(self, keywords: list) -> list:
        # Poly Haven's public API for models
        url = "https://api.polyhaven.com/assets?t=models"
        try:
            response = requests.get(url)
            if response.status_code == 200:
                assets = response.json()
                results = []
                
                # Match keywords against asset names or tags
                for uid, data in assets.items():
                    name_lower = data.get("name", "").lower()
                    tags = [t.lower() for t in data.get("tags", [])]
                    
                    # If any keyword matches name or tags
                    name_words = set(name_lower.split())
                    match = any(kw.lower() in name_words or kw.lower() in tags for kw in keywords)
                    
                    if match:
                        # Fetch file info to get the actual GLTF url
                        model_url = None
                        try:
                            file_res = requests.get(f"https://api.polyhaven.com/files/{uid}")
                            if file_res.status_code == 200:
                                files_data = file_res.json()
                                # Attempt to get the lowest res gltf for fast web loading (1k or 2k)
                                gltf_data = files_data.get("gltf", {})
                                if gltf_data:
                                    # Get the smallest available resolution key (e.g., '1k')
                                    res_key = min(gltf_data.keys(), key=lambda k: int(k.replace('k','')) if k.replace('k','').isdigit() else 99)
                                    model_url = gltf_data[res_key].get("gltf", {}).get("url")
                                    
                                    # Fallback to the larger glb if gltf format isn't nested right
                                    if not model_url and "glb" in gltf_data[res_key]:
                                         model_url = gltf_data[res_key]["glb"].get("url")
                        except Exception as fetch_err:
                            print(f"Error fetching file URLs for {uid}: {fetch_err}")

                        results.append({
                            "source": "Poly Haven",
                            "title": data.get("name"),
                            "uid": uid,
                            "thumbnails": [{"url": f"https://cdn.polyhaven.com/asset_img/thumbs/{uid}.png"}],
                            "model_url": model_url,
                            "embed_url": None,
                            "score": 95,
                            "explanation": f"High quality free HDR/PBR model from Poly Haven matching '{', '.join(keywords)}'"
                        })
                        
                    # Stop if we found a few good ones
                    if len(results) >= 2:
                        break
                return results
        except Exception as e:
            print(f"Poly Haven search failed: {e}")
            
        return []

    def _search_sketchfab(self, keywords: str) -> list:
        if not self.sketchfab_token:
            print("No Sketchfab token, skipping Sketchfab search.")
            return []
            
        # Sketchfab API example (requires auth for download urls, but free for search)
        url = "https://api.sketchfab.com/v3/search"
        params = {
            "type": "models",
            "q": keywords
        }
        headers = {}
        if self.sketchfab_token:
            headers["Authorization"] = f"Token {self.sketchfab_token}"
            
        try:
            response = requests.get(url, params=params, headers=headers)
            if response.status_code == 200:
                data = response.json()
                results = []
                for item in data.get("results", [])[:5]: # Get slightly more for sorting
                    # Calculate a dynamic score based on likes and views
                    likes = item.get("likeCount", 0)
                    views = item.get("viewCount", 0)
                    # Base score 80 + bonus for popularity up to 15
                    popularity_bonus = min(15, (likes * 10 + views) / 1000)
                    dynamic_score = 80 + popularity_bonus
                    
                    results.append({
                        "source": "Sketchfab",
                        "title": item.get("name"),
                        "uid": item.get("uid"),
                        "thumbnails": item.get("thumbnails", {}).get("images", []),
                        "model_url": None, 
                        "embed_url": f"https://sketchfab.com/models/{item.get('uid')}/embed?ui_watermark=0&ui_infos=0&ui_stop=0&ui_animations=0&ui_controls=0&transparent=1&autostart=1",
                        "score": dynamic_score,
                        "explanation": f"Match from Sketchfab for '{keywords}' (Likes: {likes}, Views: {views})"
                    })
                return results
        except Exception as e:
            print(f"Sketchfab search failed: {e}")
            
        return []

    def _generate_tripo3d(self, keywords: str) -> list:
        import time
        if not self.tripo3d_token:
            print("No Tripo3D token, skipping generation.")
            return []
            
        print(f"Generating Tripo3D model for: {keywords}")
        url = "https://api.tripo3d.ai/v2/openapi/task"
        headers = {
            "Authorization": f"Bearer {self.tripo3d_token}",
            "Content-Type": "application/json"
        }
        payload = {
            "type": "text_to_model",
            "prompt": keywords
        }
        
        try:
            # 1. Create the generation task
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            if response.status_code != 200:
                print(f"Tripo3D Task Creation Failed: {response.status_code} - {response.text}")
                return []
                
            task_data = response.json()
            if task_data.get("code") != 0:
                return []
            
            task_id = task_data.get("data", {}).get("task_id")
            if not task_id:
                return []
                
            print(f"Tripo3D task created: {task_id}. Polling for completion...")
            
            # 2. Poll the task until success (Max ~90 seconds)
            poll_url = f"https://api.tripo3d.ai/v2/openapi/task/{task_id}"
            
            for _ in range(30):
                time.sleep(3)
                poll_resp = requests.get(poll_url, headers=headers)
                if poll_resp.status_code == 200:
                    poll_data = poll_resp.json()
                    status = poll_data.get("data", {}).get("status")
                    
                    if status == "success":
                        glb_url = poll_data.get("data", {}).get("result", {}).get("model", {}).get("url")
                        return [{
                            "source": "Tripo3D AI",
                            "title": f"Generative {keywords.title()}",
                            "uid": task_id,
                            "thumbnails": [],
                            "model_url": glb_url,
                            "embed_url": None,
                            "score": 99,
                            "explanation": f"Successfully synthesized a custom 3D model using Tripo3D Generative AI for '{keywords}'."
                        }]
                    elif status in ["failed", "cancelled", "deleted"]:
                        print(f"Tripo3D task failed with status: {status}")
                        break
            
            return []
        except Exception as e:
            print(f"Tripo3D API error: {e}")
            return []
