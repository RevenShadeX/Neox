"""Generate Neox's original reusable coin artwork. Optional authoring tool: Pillow.
Runtime only reads the committed GIF/PNG files and does not require Python.
"""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(exist_ok=True)
SIZE, SCALE = 256, 2

def face(heads):
    im = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    def ellipse(box, fill, outline=None, width=1):
        d.ellipse(tuple(round(x*SCALE) for x in box), fill=fill, outline=outline, width=width*SCALE)
    def polygon(points, fill, outline=None, width=1):
        pts = [(round(x*SCALE), round(y*SCALE)) for x, y in points]
        d.polygon(pts, fill=fill)
        if outline: d.line(pts+[pts[0]], fill=outline, width=width*SCALE, joint="curve")
    def line(points, fill, width=1):
        d.line([(round(x*SCALE), round(y*SCALE)) for x, y in points], fill=fill, width=width*SCALE, joint="curve")
    ellipse((18,18,238,238), '#11101c', '#90859f', 3)
    ellipse((24,24,232,232), '#26232f', '#5e556f', 2)
    ellipse((31,31,225,225), '#14131d', '#a49eae' if heads else '#8f4dd1', 2)
    ellipse((39,39,217,217), '#22212b' if heads else '#0b0912', '#413a51', 2)
    for i in range(32):
        angle = i*math.tau/32
        line([(128+99*math.cos(angle),128+99*math.sin(angle)),(128+105*math.cos(angle),128+105*math.sin(angle))], '#8b8299', 1)
    if heads:
        # Sculpted dark-silver skull: dome, cheekbones, jaw, and inlaid eye sockets.
        ellipse((77,64,179,158), '#747582', '#d4d0df', 2)
        polygon([(79,115),(82,149),(98,160),(102,181),(154,181),(158,160),(174,149),(177,115)], '#747582', '#d4d0df', 2)
        polygon([(88,139),(98,145),(101,156),(91,153)], '#4e4a5f')
        polygon([(168,139),(158,145),(155,156),(165,153)], '#4e4a5f')
        ellipse((90,105,119,135), '#111019', '#5d576d', 2)
        ellipse((137,105,166,135), '#111019', '#5d576d', 2)
        polygon([(128,129),(119,149),(137,149)], '#22202d')
        for x in [109,119,129,139,149]: line([(x,158),(x,174)], '#393545', 2)
        line([(102,158),(153,158)], '#d4d0df', 2)
        line([(101,91),(111,80),(140,77)], '#dcd9e4', 2)
    else:
        # Black crown, three amethyst points, purple metallic trim.
        polygon([(72,96),(100,120),(128,76),(156,120),(184,96),(170,168),(86,168)], '#08070c', '#9b5ae2', 3)
        polygon([(88,151),(168,151),(165,176),(91,176)], '#21132f', '#ae74e8', 3)
        for x,y in [(72,96),(128,76),(184,96)]: ellipse((x-6,y-6,x+6,y+6), '#c39af1', '#6e399e', 1)
        polygon([(128,126),(138,142),(128,158),(118,142)], '#8a43ce', '#d0a4f7', 2)
        line([(98,157),(158,157)], '#67378e', 2)
    # Geometric signature mark, not third-party branding.
    polygon([(122,196),(128,190),(134,196),(128,202)], '#9b7ac2')
    return im.resize((SIZE,SIZE),Image.Resampling.LANCZOS)

def background():
    im=Image.new('RGB',(SIZE,SIZE),'#0b0912')
    glow=Image.new('RGB',(SIZE,SIZE),'#0b0912')
    ImageDraw.Draw(glow).ellipse((22,22,234,234),fill='#362047')
    return Image.blend(im,glow.filter(ImageFilter.GaussianBlur(20)),0.65).convert('RGBA')

faces=[face(True),face(False)]
for key,coin in zip(['heads','tails'],faces):
    im=background();im.alpha_composite(coin);im.convert('RGB').save(OUT/f'dark-coin-{key}.png',optimize=True)
frames=[]
for i in range(32):
    theta=i*math.tau/32
    width=max(7,round(SIZE*abs(math.cos(theta))))
    coin=faces[0 if math.cos(theta)>=0 else 1].resize((width,SIZE),Image.Resampling.LANCZOS)
    frame=background()
    # A visible metal rim gives the edge-on frame real cylindrical thickness.
    edge=ImageDraw.Draw(frame)
    half=width*110/256+4
    edge.ellipse((128-half,18,128+half,238),fill='#393342',outline='#8d6ba5',width=2)
    frame.alpha_composite(coin,((SIZE-width)//2,0))
    frames.append(frame.convert('RGB').resize((160,160),Image.Resampling.LANCZOS))
frames[0].save(OUT/'dark-coin-spin.gif',save_all=True,append_images=frames[1:],duration=55,loop=0,optimize=True)
print('Generated original Neox heads, tails, and 32-frame spinning coin.')
