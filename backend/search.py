import requests

import json
import concurrent.futures
import os
from cache import QueryCache

class ModelSearchEngine:
    def __init__(self):
        # We can configure keys for Sketchfab, PolyHaven, etc.
        self.sketchfab_token = os.getenv("SKETCHFAB_API_TOKEN")
        self.tripo3d_token = os.getenv("TRIPO3D_API_KEY")
        self.cache = QueryCache()

    def search(self, intent_data: dict) -> list:
        """
        Queries various APIs based on the extracted intent.
        """
        keywords_list = intent_data.get("primary_keywords", [])
        keywords = " ".join(keywords_list)
        
        # Check cache first
        cached_results = self.cache.get_cached_results(keywords)
        if cached_results:
            print(f"Returning cached results for: {keywords}")
            return cached_results
            
        import concurrent.futures
        
        results = []
        
        # Parallelize API Calls
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            future_tripo = executor.submit(self._generate_tripo3d, keywords)
            future_sketchfab = executor.submit(self._search_sketchfab, keywords)
            future_polyhaven = executor.submit(self._search_polyhaven, keywords_list)
            
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
            
        # If no real 3D models found, add 2D image fallback
        if not results:
            print(f"No 3D models found for '{keywords}', generating 2D fallback.")
            img_fallback = self._generate_2d_image(keywords)
            if img_fallback:
                results.append(img_fallback)

        # Always add procedural fallback
        results.append({
            "source": "Procedural Engine",
            "title": f"Procedural {keywords.title()}",
            "uid": f"proc-{keywords.replace(' ', '-')}-1",
            "thumbnails": [],
            "model_url": None,
            "score": 60, # Lower score for procedural
            "explanation": f"Using structural primitives to represent '{keywords}'.",
            "procedural_data": {
                "components": intent_data.get("structural_components", ["box"])
            }
        })
        
        # Sort results by score (descending)
        results.sort(key=lambda x: x.get("score", 0), reverse=True)
        
        # Save to cache before returning
        self.cache.cache_results(keywords, results)
        
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
