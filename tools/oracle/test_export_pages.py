"""Page-copy invariants; these tests never start the original application."""
import struct
import unittest
from pathlib import Path

from export_pages import document_pages, select_page


class PageCopyTests(unittest.TestCase):
    def test_corpus_headers_and_copy_isolation(self):
        root = Path(__file__).resolve().parents[2]
        sources = list((root / "samples/baseline/samples").glob("*.gsp"))
        corpus = root / "original/sketchpad5"
        if corpus.exists():
            sources.extend(corpus.rglob("*.gsp"))
        multi = 0
        for source in sources:
            raw = source.read_bytes()
            count, active = document_pages(raw)
            index = (active + 1) % count
            copy = select_page(raw, index)
            self.assertEqual(document_pages(copy), (count, index), str(source))
            self.assertEqual(copy[:28], raw[:28])
            self.assertEqual(copy[30:], raw[30:])
            self.assertEqual(source.read_bytes(), raw)
            multi += count > 1
        self.assertGreater(len(sources), 0)
        if corpus.exists():
            self.assertGreater(multi, 0)

    def test_rejects_invalid_page_and_header(self):
        root = Path(__file__).resolve().parents[2]
        raw = (root / "samples/baseline/samples/midpoint.gsp").read_bytes()
        for index in (-1, 1, 65535):
            with self.assertRaises(ValueError):
                select_page(raw, index)
        for bad in (b"", b"GSP4", raw[:-1]):
            with self.assertRaises(ValueError):
                document_pages(bad)
        altered = bytearray(raw)
        struct.pack_into("<H", altered, 14, 2)
        with self.assertRaises(ValueError):
            document_pages(altered)


if __name__ == "__main__":
    unittest.main()
