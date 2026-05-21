from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "test-images"
SIGNATURE = bytes([0x47, 0x42, 0x37, 0x1D])


def save_gb7(path, width, height, masked=False):
    header = bytearray()
    header.extend(SIGNATURE)
    header.append(0x01)
    header.append(0x01 if masked else 0x00)
    header.extend(width.to_bytes(2, "big"))
    header.extend(height.to_bytes(2, "big"))
    header.extend((0).to_bytes(2, "big"))

    pixels = bytearray()
    cx = width / 2
    cy = height / 2
    radius = min(width, height) * 0.36

    for y in range(height):
        for x in range(width):
            gray = round(((x / max(1, width - 1)) * 0.65 + (y / max(1, height - 1)) * 0.35) * 127)
            mask_bit = 0

            if masked:
                distance = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                mask_bit = 0x80 if distance < radius else 0

            pixels.append(mask_bit | gray)

    path.write_bytes(header + pixels)


def make_gradient_png(path):
    width, height = 420, 280
    image = Image.new("RGBA", (width, height))
    pixels = image.load()

    for y in range(height):
        for x in range(width):
            red = round(255 * x / (width - 1))
            green = round(210 * y / (height - 1))
            blue = 150
            alpha = 255 if (x + y) % 38 > 8 else 175
            pixels[x, y] = (red, green, blue, alpha)

    draw = ImageDraw.Draw(image)
    draw.rectangle((28, 28, 185, 120), outline=(15, 40, 60, 255), width=4)
    draw.ellipse((230, 70, 370, 210), outline=(255, 255, 255, 230), width=5)
    image.save(path)


def make_photo_like_jpg(path):
    width, height = 960, 540
    image = Image.new("RGB", (width, height), "#dce7ef")
    pixels = image.load()

    for y in range(height):
        for x in range(width):
            sky = round(190 + 50 * (1 - y / height))
            land = round(70 + 80 * y / height)
            if y < height * 0.58:
                pixels[x, y] = (70 + x % 35, 135 + y % 45, sky)
            else:
                pixels[x, y] = (land, 118 + x % 50, 88 + y % 35)

    draw = ImageDraw.Draw(image)
    draw.polygon([(0, 330), (220, 170), (410, 330)], fill=(77, 94, 107))
    draw.polygon([(260, 330), (520, 130), (780, 330)], fill=(86, 104, 119))
    draw.polygon([(580, 330), (790, 190), (960, 330)], fill=(79, 97, 112))
    draw.ellipse((690, 70, 760, 140), fill=(255, 213, 94))
    image.save(path, quality=90)


def make_large_png(path):
    width, height = 2200, 1350
    image = Image.new("RGB", (width, height), "#f6f8fb")
    draw = ImageDraw.Draw(image)

    for step in range(0, width, 80):
        color = (170 + step % 60, 185, 205)
        draw.line((step, 0, step, height), fill=color, width=1)

    for step in range(0, height, 80):
        color = (190, 190 + step % 45, 178)
        draw.line((0, step, width, step), fill=color, width=1)

    for i in range(18):
        left = 90 + i * 112
        top = 120 + (i % 5) * 185
        right = left + 76
        bottom = top + 76
        draw.rectangle((left, top, right, bottom), fill=(34, 135, 146), outline=(23, 50, 58), width=3)

    image.save(path)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)

    make_gradient_png(OUTPUT / "transparent-gradient.png")
    make_photo_like_jpg(OUTPUT / "landscape-sample.jpg")
    make_large_png(OUTPUT / "large-grid.png")
    save_gb7(OUTPUT / "graybit-gradient.gb7", 320, 200, masked=False)
    save_gb7(OUTPUT / "graybit-mask.gb7", 300, 300, masked=True)


if __name__ == "__main__":
    main()

