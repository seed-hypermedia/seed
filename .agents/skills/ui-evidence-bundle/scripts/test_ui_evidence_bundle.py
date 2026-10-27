import copy, importlib.util, json, tempfile, unittest, zipfile
from pathlib import Path
P=Path(__file__).with_name('ui-evidence-bundle.py'); S=importlib.util.spec_from_file_location('bundle',P); M=importlib.util.module_from_spec(S); S.loader.exec_module(M)
SHA='a'*40
class Tests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(); self.d=Path(self.t.name); (self.d/'shot.png').write_bytes(b'png')
  self.spec={'schemaVersion':1,'kind':'seed.ui-evidence','source':{'repository':'seed-hypermedia/seed','issue':'438','sourceSha':SHA},'acceptance':{'surface':'desktop-electron','scenario':'deleted-menu','verdict':'verified'},'checks':[{'id':'menu-absent','status':'passed','description':'Deleted-content menu is absent','evidence':['shot']}],'files':[{'id':'shot','sourcePath':'shot.png','bundlePath':'shot.png','mediaType':'image/png','publicUrl':'ipfs://bafytest'}]}
 def tearDown(self): self.t.cleanup()
 def make(self,spec=None,name='out.zip'):
  p=self.d/'spec.json'; p.write_text(json.dumps(spec or self.spec)); return M.create(p,self.d/name)
 def test_round_trip_is_deterministic(self):
  a=self.make(name='a.zip'); b=self.make(name='b.zip'); self.assertEqual((self.d/'a.zip').read_bytes(),(self.d/'b.zip').read_bytes()); self.assertEqual(M.verify(self.d/'a.zip')['manifest']['source']['sourceSha'],SHA)
 def test_build_source_must_match(self):
  s=copy.deepcopy(self.spec); s['build']={'workflowCommit':'b'*40,'sourceSha':'c'*40,'manifestVerified':True,'sha256':'d'*64,'runUrl':'https://github.com/x/actions/runs/1'}
  with self.assertRaisesRegex(ValueError,'provenance'): self.make(s)
 def test_manifest_verified_required(self):
  s=copy.deepcopy(self.spec); s['build']={'workflowCommit':'b'*40,'sourceSha':SHA,'manifestVerified':False,'sha256':'d'*64,'runUrl':'https://github.com/x/actions/runs/1'}
  with self.assertRaises(ValueError): self.make(s)
 def test_dangling_reference_rejected(self):
  s=copy.deepcopy(self.spec); s['checks'][0]['evidence']=['missing']
  with self.assertRaisesRegex(ValueError,'dangling'): self.make(s)
 def test_path_escape_rejected(self):
  s=copy.deepcopy(self.spec); s['files'][0]['sourcePath']='../secret'
  with self.assertRaisesRegex(ValueError,'safe relative|escapes'): self.make(s)
 def test_changed_member_rejected(self):
  self.make(); z=self.d/'bad.zip'
  with zipfile.ZipFile(self.d/'out.zip') as src, zipfile.ZipFile(z,'w') as dst:
   for i in src.infolist(): dst.writestr(i, b'changed' if i.filename=='evidence/shot.png' else src.read(i))
  with self.assertRaisesRegex(ValueError,'hash mismatch'): M.verify(z)
 def test_extra_member_rejected(self):
  self.make(); z=self.d/'extra.zip'; z.write_bytes((self.d/'out.zip').read_bytes())
  with zipfile.ZipFile(z,'a') as dst: dst.writestr('extra.txt',b'x')
  with self.assertRaisesRegex(ValueError,'do not match'): M.verify(z)
 def test_public_url_scheme_rejected(self):
  s=copy.deepcopy(self.spec); s['files'][0]['publicUrl']='file:///tmp/x'
  with self.assertRaisesRegex(ValueError,'publicUrl'): self.make(s)

 def test_expected_source_binding(self):
  self.make()
  with self.assertRaisesRegex(ValueError,'expected source'): M.verify(self.d/'out.zip','b'*40)
 def test_source_symlink_rejected(self):
  (self.d/'link.png').symlink_to(self.d/'shot.png'); s=copy.deepcopy(self.spec); s['files'][0]['sourcePath']='link.png'
  with self.assertRaisesRegex(ValueError,'symlink'): self.make(s)
 def test_excessive_member_metadata_rejected_before_read(self):
  self.make(); z=self.d/'many.zip'
  with zipfile.ZipFile(z,'w') as dst:
   for i in range(M.MAX_FILES+3): dst.writestr(f'x{i}',b'')
  with self.assertRaisesRegex(ValueError,'member count'): M.verify(z)

if __name__=='__main__': unittest.main()
