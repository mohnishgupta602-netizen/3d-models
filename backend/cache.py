import os
import chromadb
import json

class QueryCache:
    def __init__(self, db_path="./chroma_db_final"):
        self.client = chromadb.PersistentClient(path=db_path)
        # Create or get the collection for storing model query responses
        self.collection = self.client.get_or_create_collection(
            name="3d_model_cache"
        )
        
    def get_cached_results(self, query: str):
        # We search for the exact query or very similar
        # For a simple cache, we can just use the query as the ID if we want exact matches,
        # but Chroma allows semantic search too. Let's do a simple text query for exact match first.
        try:
            results = self.collection.get(ids=[query.lower()])
            if results and results.get("metadatas") and len(results["metadatas"]) > 0:
                raw_data = results["metadatas"][0].get("response_json")
                if raw_data:
                    return json.loads(raw_data)
        except Exception as e:
            print(f"Cache miss or error: {e}")
        return None

    def cache_results(self, query: str, data: list):
        try:
            self.collection.upsert(
                documents=[query],
                metadatas=[{"response_json": json.dumps(data)}],
                ids=[query.lower()]
            )
        except Exception as e:
            print(f"Failed to cache results: {e}")
