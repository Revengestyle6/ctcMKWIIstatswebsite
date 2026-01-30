#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Music compression script - Reduces MP3 bitrate to save bandwidth
Compresses music files to 128kbps (good quality for background music)
"""

import os
import sys
from pathlib import Path
import subprocess

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

MUSIC_DIR = Path("frontend/public/music")
OUTPUT_DIR = Path("frontend/public/music_compressed")

def check_ffmpeg():
    """Check if FFmpeg is available"""
    try:
        result = subprocess.run(['ffmpeg', '-version'], 
                              capture_output=True, 
                              text=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False

def compress_music():
    """Compress MP3 files to 128kbps"""
    if not MUSIC_DIR.exists():
        print(f"❌ Music directory not found: {MUSIC_DIR}")
        return
    
    if not check_ffmpeg():
        print("❌ FFmpeg not found!")
        print("\nTo install FFmpeg on Windows:")
        print("1. Download from: https://ffmpeg.org/download.html")
        print("2. Or use: winget install FFmpeg")
        print("3. Or use Chocolatey: choco install ffmpeg")
        return
    
    OUTPUT_DIR.mkdir(exist_ok=True)
    
    mp3_files = list(MUSIC_DIR.glob("*.mp3"))
    total = len(mp3_files)
    
    if total == 0:
        print(f"❌ No MP3 files found in {MUSIC_DIR}")
        return
    
    print(f"🎵 Found {total} MP3 files")
    print(f"🔄 Compressing to 128kbps...\n")
    
    total_before = 0
    total_after = 0
    
    for i, mp3_path in enumerate(mp3_files, 1):
        try:
            # Get original size
            before_size = mp3_path.stat().st_size
            total_before += before_size
            
            # Output path
            output_path = OUTPUT_DIR / mp3_path.name
            
            # Compress with FFmpeg (128kbps, constant bitrate)
            cmd = [
                'ffmpeg', '-i', str(mp3_path),
                '-b:a', '128k',
                '-c:a', 'libmp3lame',
                '-y',  # Overwrite without asking
                str(output_path)
            ]
            
            result = subprocess.run(cmd, 
                                   capture_output=True, 
                                   text=True)
            
            if result.returncode != 0:
                print(f"  ❌ Error with {mp3_path.name}")
                continue
            
            # Get new size
            after_size = output_path.stat().st_size
            total_after += after_size
            
            reduction = (1 - after_size/before_size) * 100
            before_mb = before_size / 1024 / 1024
            after_mb = after_size / 1024 / 1024
            
            print(f"  [{i}/{total}] {mp3_path.name}")
            print(f"           {before_mb:.1f} MB → {after_mb:.1f} MB ({reduction:.1f}% smaller)")
        
        except Exception as e:
            print(f"  ❌ Error with {mp3_path.name}: {e}")
    
    # Summary
    total_reduction = (1 - total_after/total_before) * 100
    before_mb = total_before / 1024 / 1024
    after_mb = total_after / 1024 / 1024
    saved_mb = before_mb - after_mb
    
    print(f"\n✅ Compression complete!")
    print(f"📊 Before: {before_mb:.1f} MB")
    print(f"📊 After:  {after_mb:.1f} MB")
    print(f"💾 Saved:  {saved_mb:.1f} MB ({total_reduction:.1f}% reduction)")
    print(f"\n📁 Compressed files saved to: {OUTPUT_DIR}")
    print("\n⚠️  IMPORTANT: Replace old music folder:")
    print(f"   1. Delete: {MUSIC_DIR}")
    print(f"   2. Rename: {OUTPUT_DIR} → {MUSIC_DIR}")

if __name__ == "__main__":
    print("🚀 Music Compression Tool\n")
    compress_music()
    print("\n✨ Done!")
