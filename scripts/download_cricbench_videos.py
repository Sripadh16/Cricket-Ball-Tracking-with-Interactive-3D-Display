import os
import sys
import json
import urllib.request
from pathlib import Path

def download_cricbench_videos(count=5, dest_dir="sample_videos"):
    dest_path = Path(dest_dir)
    dest_path.mkdir(exist_ok=True, parents=True)
    
    api_url = "https://huggingface.co/api/datasets/cricverse/CricBench/tree/main/videos"
    print(f"Fetching video list from Hugging Face ({api_url})...")
    
    req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        items = json.loads(resp.read().decode('utf-8'))
        
    print(f"Total available clips in dataset: {len(items)}")
    
    to_download = items[:count] if count > 0 else items
    print(f"Downloading {len(to_download)} clips into '{dest_path.resolve()}'...\n")
    
    downloaded = []
    for idx, item in enumerate(to_download, 1):
        rel_path = item.get('path', '')
        filename = Path(rel_path).name
        file_dest = dest_path / filename
        file_size_mb = item.get('size', 0) / (1024 * 1024)
        
        if file_dest.exists() and file_dest.stat().st_size == item.get('size', 0):
            print(f"[{idx}/{len(to_download)}] {filename} ({file_size_mb:.2f} MB) already exists, skipping.")
            downloaded.append(str(file_dest))
            continue
            
        download_url = f"https://huggingface.co/datasets/cricverse/CricBench/resolve/main/{rel_path}"
        print(f"[{idx}/{len(to_download)}] Downloading {filename} ({file_size_mb:.2f} MB)...")
        
        try:
            req_file = urllib.request.Request(download_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req_file) as file_resp, open(file_dest, 'wb') as f_out:
                while True:
                    chunk = file_resp.read(1024 * 1024)
                    if not chunk:
                        break
                    f_out.write(chunk)
            print(f"  -> Successfully saved: {file_dest.name}")
            downloaded.append(str(file_dest))
        except Exception as e:
            print(f"  -> Error downloading {filename}: {e}")
            
    print(f"\nDownload finished! {len(downloaded)} clips available in '{dest_dir}'.")
    return downloaded

if __name__ == "__main__":
    num = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    download_cricbench_videos(count=num)

