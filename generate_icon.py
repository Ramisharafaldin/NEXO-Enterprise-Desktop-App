"""
Generates the high-fidelity multi-resolution NEXO icon (nexo.ico and nexo.png)
Using Pillow, matching NEXO's dark charcoal badge (#343D46 / #1E293B) and
vibrant blue/cyan geometric "N" emblem (#00E5FF / #2196F3 / #0284C7).
"""

import os
from PIL import Image, ImageDraw

def create_nexo_icon(output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    ico_path = os.path.join(output_dir, "nexo.ico")
    png_path = os.path.join(output_dir, "nexo.png")

    # Render at 512x512 with anti-aliasing supersampling
    base_size = 512
    img = Image.new("RGBA", (base_size, base_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Rounded Charcoal Badge Background
    pad = 16
    radius = 110
    badge_rect = [pad, pad, base_size - pad, base_size - pad]
    
    # Charcoal base (#343D46 -> #1E293B)
    draw.rounded_rectangle(badge_rect, radius=radius, fill=(40, 50, 60, 255), outline=(71, 85, 105, 180), width=6)

    # Inner subtle glow
    inner_rect = [pad + 6, pad + 6, base_size - pad - 6, base_size - pad - 6]
    draw.rounded_rectangle(inner_rect, radius=radius - 4, outline=(51, 65, 85, 120), width=3)

    # Scale coordinates from 100x100 SVG to 512x512
    def sc(x, y):
        return (pad + (x / 100.0) * (base_size - 2 * pad),
                pad + (y / 100.0) * (base_size - 2 * pad))

    # 2. Left Vertical Beam (Pillar Left: #38BDF8 -> #0284C7)
    pillar_left = [
        sc(24, 26),
        sc(32, 18),
        sc(36, 18),
        sc(44, 26),
        sc(44, 56),
        sc(24, 82)
    ]
    draw.polygon(pillar_left, fill=(2, 132, 199, 255)) # #0284C7

    # Highlight upper left
    draw.line([sc(24, 26), sc(32, 18), sc(36, 18)], fill=(56, 189, 248, 255), width=8)

    # 3. Bold High-Speed Diagonal Slash (Diagonal: #00E5FF -> #2196F3 -> #1E40AF)
    diagonal_poly = [
        sc(32, 18),
        sc(76, 74),
        sc(71.5, 82),
        sc(60, 82),
        sc(54, 76),
        sc(24, 34),
        sc(27, 27)
    ]
    draw.polygon(diagonal_poly, fill=(33, 150, 243, 255)) # Vibrant #2196F3

    # High-speed cyan top overlay
    cyan_streak = [
        sc(32, 18),
        sc(58, 50),
        sc(48, 56),
        sc(27, 27)
    ]
    draw.polygon(cyan_streak, fill=(0, 229, 255, 230)) # Cyan #00E5FF

    # 4. Right Vertical Beam (Pillar Right: #2196F3 -> #0F172A)
    pillar_right = [
        sc(68, 82),
        sc(76, 82),
        sc(84, 74),
        sc(84, 26),
        sc(76, 18),
        sc(76, 74),
        sc(68, 82)
    ]
    draw.polygon(pillar_right, fill=(33, 150, 243, 255))
    draw.line([sc(76, 82), sc(84, 74), sc(84, 26)], fill=(56, 189, 248, 255), width=6)

    # 5. Glowing Apex Spark at top right (cx=76, cy=22, r=4.5)
    cx, cy = sc(76, 21)
    spark_r = 24
    draw.ellipse([cx - spark_r, cy - spark_r, cx + spark_r, cy + spark_r], fill=(0, 229, 255, 255), outline=(255, 255, 255, 220), width=4)
    # Inner white core
    core_r = 10
    draw.ellipse([cx - core_r, cy - core_r, cx + core_r, cy + core_r], fill=(255, 255, 255, 255))

    # Save PNG
    img.save(png_path, format="PNG")

    # Generate multi-resolution ICO file
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(ico_path, format="ICO", sizes=sizes)
    print(f"Generated {ico_path} with sizes: {sizes}")
    print(f"Generated {png_path} (512x512)")

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "public")
    create_nexo_icon(out)
