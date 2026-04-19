import json
import sys
from pathlib import Path

from pypdf import PdfReader


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Missing PDF path"}))
        return 1

    pdf_path = Path(sys.argv[1])
    password = sys.argv[2] if len(sys.argv) > 2 else ""

    try:
      reader = PdfReader(str(pdf_path))
      if reader.is_encrypted:
          if not password:
              print(json.dumps({"ok": False, "error": "PDF is encrypted but no password was provided"}))
              return 0

          decrypt_result = reader.decrypt(password)
          if decrypt_result == 0:
              print(json.dumps({"ok": False, "error": "Failed to decrypt PDF with the provided password"}))
              return 0

      texts = []
      for page in reader.pages:
          try:
              texts.append(page.extract_text() or "")
          except Exception as page_error:
              texts.append(f"\n[page extract error: {page_error}]\n")

      print(json.dumps({"ok": True, "text": "\n".join(texts)}))
      return 0
    except Exception as error:
      print(json.dumps({"ok": False, "error": str(error)}))
      return 0


if __name__ == "__main__":
    raise SystemExit(main())
