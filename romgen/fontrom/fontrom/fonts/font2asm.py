# Open the file in binary mode with 


def read_font(file_path):
    with open(file_path, 'rb') as file:
        return bytearray(file.read())

def rotate_glyph(glyph):
    rotated = [0] * 16  # Initialize the rotated glyph array

    for x in range(8):
        for y in range(16):
            bit = (glyph[y] >> x) & 1
            rotated[(7-x)*2 + (15-y)//8] |= bit << (y % 8)

    return rotated

def process_font(font_data):
    glyphs = []

    for i in range(0, len(font_data), 16):
        glyph = font_data[i:i+16]
        rotated_glyph = rotate_glyph(glyph)
        glyphs.extend(rotated_glyph)

    return glyphs

def output_rotated_font(rotated_data):
    count = 0
    for index in range(0, len(rotated_data), 2):
        if count % 8 == 0:
            value = count // 8
            ascii = chr(value)
            ascii = ascii.encode('ascii', errors='ignore')
            print(f"\r\n\r\n    ; ASCII: {value}:{ascii}")

        count = count + 1
        b1 = format(rotated_data[index], '08b')
        b2 = format(rotated_data[index+1], '08b') 
        print(f"    .byte %{b1},%{b2}")

# Main script
input_file = 'vga-rom.f16'

font_data = read_font(input_file)
rotated_data = process_font(font_data)
output_rotated_font(rotated_data)



#with open('vga-rom.f16', 'rb') as file: 
#    count = 0
#    print("dosfont:\r\n", end='')
#    while True:
#        byte = file.read(1) 
#        if not byte:
#            break
#        binary_representation = format(ord(byte), '08b') 
#        print(f"    .byte %{binary_representation}")
#        count += 1
#        if count % 16 == 0:
#            print('\r\n\r\n', end='')
#            c = int(count/16)
#            print(f"    ; ascii :{c:04d}\r\n", end='')
  
