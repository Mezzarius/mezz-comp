from PIL import Image

SCALE = 4

im = Image.open("spritesheet.png").convert("RGBA")

up = im.resize(
    (im.width * SCALE, im.height * SCALE),
    resample=Image.NEAREST
)

up.save("spritesheet_hd_4x.png")

print("Done.")