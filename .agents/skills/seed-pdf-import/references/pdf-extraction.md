# PDF Content Extraction Reference

Tools for extracting text, tables, and images from PDFs. Use as a fallback when LLM vision alone is insufficient (e.g.,
very large PDFs, dense tables, or when images need to be extracted as files).

## Python Libraries

### pypdf -- Basic Text Extraction

```python
from pypdf import PdfReader

reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")

text = ""
for page in reader.pages:
    text += page.extract_text()
```

### pdfplumber -- Text and Tables

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        # Text with layout
        text = page.extract_text()
        print(text)

        # Tables as lists of rows
        tables = page.extract_tables()
        for table in tables:
            for row in table:
                print(row)
```

Advanced table extraction with custom settings:

```python
with pdfplumber.open("document.pdf") as pdf:
    page = pdf.pages[0]
    tables = page.extract_tables({
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "snap_tolerance": 3,
    })
```

### pypdfium2 -- Page Rendering

Render PDF pages as images for visual analysis or figure extraction:

```python
import pypdfium2 as pdfium

pdf = pdfium.PdfDocument("document.pdf")
for i, page in enumerate(pdf):
    bitmap = page.render(scale=2.0)
    img = bitmap.to_pil()
    img.save(f"/tmp/pdf-images/page_{i+1}.png", "PNG")
```

### pytesseract -- OCR for Scanned PDFs

```python
import pytesseract
from pdf2image import convert_from_path

images = convert_from_path('scanned.pdf')
text = ""
for i, image in enumerate(images):
    text += f"Page {i+1}:\n"
    text += pytesseract.image_to_string(image)
    text += "\n\n"
```

## Command-Line Tools

### pdftotext (poppler-utils)

```bash
pdftotext input.pdf output.txt              # Basic extraction
pdftotext -layout input.pdf output.txt      # Preserve layout
pdftotext -f 1 -l 5 input.pdf output.txt   # Pages 1-5
```

### pdfimages (poppler-utils) -- Extract Embedded Images

```bash
# Extract all images as JPEG files
pdfimages -j input.pdf /tmp/pdf-images/img

# Produces: /tmp/pdf-images/img-000.jpg, img-001.jpg, etc.

# Extract images preserving original format
pdfimages -all input.pdf /tmp/pdf-images/img

# List image info without extracting
pdfimages -list input.pdf
```

### pdftoppm (poppler-utils) -- Page-to-Image

```bash
# Render pages as PNG at 300 DPI
pdftoppm -png -r 300 input.pdf /tmp/pdf-images/page

# Produces: /tmp/pdf-images/page-1.png, page-2.png, etc.
```

## Quick Reference

| Task                    | Best Tool               | Notes                                 |
| ----------------------- | ----------------------- | ------------------------------------- |
| Extract text            | pdfplumber or pdftotext | pdfplumber better for structured text |
| Extract tables          | pdfplumber              | `page.extract_tables()`               |
| Extract embedded images | pdfimages               | Fastest, preserves original quality   |
| Render pages as images  | pypdfium2 or pdftoppm   | For visual analysis or figure capture |
| OCR scanned PDFs        | pytesseract + pdf2image | Convert to image first, then OCR      |
| Quick text dump         | pdftotext -layout       | CLI, preserves spatial layout         |

## Installation

```bash
# Python libraries
pip install pypdf pdfplumber pypdfium2

# For OCR
pip install pytesseract pdf2image

# CLI tools (poppler-utils)
# Fedora/RHEL
sudo dnf install poppler-utils
# Debian/Ubuntu
sudo apt-get install poppler-utils
# macOS
brew install poppler
```
