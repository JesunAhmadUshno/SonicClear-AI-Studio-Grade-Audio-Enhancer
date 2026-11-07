"""Tests for the Flask upload handler in app.py. Needs Flask (processing is stubbed, so no FFmpeg).

    python3 -m unittest discover -s tests
"""
import io
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


class UploadTest(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd()
        self.tmp = tempfile.TemporaryDirectory()
        work = os.path.join(self.tmp.name, 'work')
        os.makedirs(work)
        os.chdir(work)  # app.py uses the relative folder 'uploads'
        import app
        self.app = app
        os.makedirs(app.UPLOAD_FOLDER, exist_ok=True)
        self.client = app.app.test_client()

    def tearDown(self):
        os.chdir(self.cwd)
        self.tmp.cleanup()

    def post(self, filename):
        with mock.patch.object(self.app, 'process_audio'):
            return self.client.post('/process', data={
                'file': (io.BytesIO(b'payload'), filename), 'denoise': 'true'})

    def test_traversal_filename_stays_in_uploads(self):
        self.post('../escaped.txt')
        work = os.getcwd()
        self.assertFalse(os.path.exists(os.path.join(work, 'escaped.txt')))
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, 'escaped.txt')))

    def test_plain_filename_still_works(self):
        r = self.post('song.wav')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(os.path.exists(os.path.join('uploads', 'song.wav')))
        self.assertEqual(r.get_json()['download_url'], '/download/processed_song.mp3')


if __name__ == '__main__':
    unittest.main()
