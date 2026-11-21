"""GitHub Actions-specific security regression tests."""
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]

def load(name, path):
    spec=importlib.util.spec_from_file_location(name, ROOT/path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

pkg=load('gha_pack','ci/pack_outputs.py')
cfg=load('gha_registry','ci/check_registry_config.py')
scanner=load('gha_scan','scripts/independent_scan_attestation.py')

class ImageOriginSecurityTests(unittest.TestCase):
    A='sha256:'+'a'*64
    B='sha256:'+'b'*64
    def test_honest_config_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            (root/'a').write_text(self.A);(root/'b').write_text(self.A)
            (root/'manifest').write_text(json.dumps({'schemaVersion':2,'config':{'digest':self.A},'layers':[{'digest':self.B}]}))
            self.assertEqual(cfg.verify(root/'manifest',root/'a',root/'b'),self.A)
    def test_mismatch_with_registry_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            (root/'a').write_text(self.A);(root/'b').write_text(self.A)
            (root/'manifest').write_text(json.dumps({'schemaVersion':2,'config':{'digest':self.B},'layers':[{'digest':self.B}]}))
            with self.assertRaisesRegex(ValueError,'registry config digest'):
                cfg.verify(root/'manifest',root/'a',root/'b')
    def test_different_builder_ids_are_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            (root/'a').write_text(self.A);(root/'b').write_text(self.B)
            (root/'manifest').write_text(json.dumps({'config':{'digest':self.A},'layers':[{'digest':self.B}]}))
            with self.assertRaisesRegex(ValueError,'two attested builder config'):
                cfg.verify(root/'manifest',root/'a',root/'b')
    def test_unexpected_multiarch_index_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            (root/'a').write_text(self.A);(root/'b').write_text(self.A)
            (root/'manifest').write_text(json.dumps({'manifests':[{'digest':self.B}]}))
            with self.assertRaisesRegex(ValueError,'single-platform'):
                cfg.verify(root/'manifest',root/'a',root/'b')
    def test_scanner_exact_reference_required(self):
        ref='ghcr.io/example-org/applications/a@'+self.A
        scanner.scan_targets_digest({'source':{'target':{'userInput':'registry:'+ref,'manifestDigest':self.A}}},ref)
        with self.assertRaisesRegex(ValueError,'immutable repository'):
            scanner.scan_targets_digest({'source':{'target':{'userInput':'registry:evil.example/not-a@'+self.A,'manifestDigest':self.A}}},ref)
        with self.assertRaisesRegex(ValueError,'contradicts'):
            scanner.scan_targets_digest({'source':{'target':{'userInput':ref,'manifestDigest':self.B}}},ref)

class OutputTransportTests(unittest.TestCase):
    def test_transport_round_trip_with_sha(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp); source=root/'source'; dest=root/'dest'
            (source/'target').mkdir(parents=True);dest.mkdir()
            (source/'target/app.jar').write_bytes(b'controlled Java bytes')
            info=pkg.manifest(source,'target/app.jar')
            manifest=root/'manifest.json'; manifest.write_text(json.dumps(info))
            archive=root/'outputs.tar'
            pkg.pack(source,manifest,archive);pkg.unpack(dest,manifest,archive)
            self.assertEqual((dest/'target/app.jar').read_bytes(),b'controlled Java bytes')
    def test_sha_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'source';dest=root/'dest'
            source.mkdir();dest.mkdir();(source/'code.py').write_bytes(b'expected')
            man=root/'manifest.json';man.write_text(json.dumps(pkg.manifest(source,'code.py')))
            tar=root/'outputs.tar';pkg.pack(source,man,tar)
            with tarfile.open(tar,'w') as f:
                content=b'tampered'; ti=tarfile.TarInfo('code.py');ti.size=len(content);f.addfile(ti,io.BytesIO(content))
            with self.assertRaisesRegex(ValueError,'SHA-256 manifest'):
                pkg.unpack(dest,man,tar)
    def test_tar_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp); source=root/'source';dest=root/'dest'
            source.mkdir();dest.mkdir();(source/'code.py').write_bytes(b'ok')
            man=root/'manifest.json';man.write_text(json.dumps(pkg.manifest(source,'code.py')))
            tar=root/'evil.tar'
            with tarfile.open(tar,'w') as f:
                b=b'evil'; info=tarfile.TarInfo('../escape');info.size=len(b);f.addfile(info,io.BytesIO(b))
            with self.assertRaisesRegex(ValueError,'undeclared'):
                pkg.unpack(dest,man,tar)
            self.assertFalse((root/'escape').exists())
    def test_symlink_member_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'source';dest=root/'dest'
            source.mkdir();dest.mkdir();(source/'code.py').write_bytes(b'ok')
            man=root/'manifest.json';man.write_text(json.dumps(pkg.manifest(source,'code.py')))
            tar=root/'evil.tar'
            with tarfile.open(tar,'w') as f:
                info=tarfile.TarInfo('code.py');info.type=tarfile.SYMTYPE;info.linkname='/etc/passwd';f.addfile(info)
            with self.assertRaisesRegex(ValueError,'non-regular'):
                pkg.unpack(dest,man,tar)

if __name__=='__main__':unittest.main()
