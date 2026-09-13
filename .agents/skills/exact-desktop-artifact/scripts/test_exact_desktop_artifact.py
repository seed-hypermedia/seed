#!/usr/bin/env python3
import importlib.util, io, pathlib, tempfile, unittest, zipfile
from unittest import mock
P=pathlib.Path(__file__).with_name('exact-desktop-artifact.py')
s=importlib.util.spec_from_file_location('artifact',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
SHA='a'*40; COMMIT='b'*40

def archive(manifest=SHA):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as z:
  z.writestr('nested/ION-SOURCE-SHA.txt',manifest+'\n'); z.writestr('app.rpm',b'package')
 return out.getvalue()

class TestHarness(unittest.TestCase):
 def test_exact_sha_is_consistent_and_printf_is_one_line(self):
  y=m.render(SHA,'438'); self.assertGreaterEqual(y.count(SHA),4)
  self.assertIn("printf '%s\\n' '"+SHA+"' >",y); self.assertIn(m.artifact_name(SHA,'438'),y)
  self.assertIn('persist-credentials: false',y); self.assertIn("-name '*.rpm'",y)

 def test_rejects_untrusted_inputs(self):
  for sha,issue in [('HEAD','438'),(SHA,'438\nname: pwn'),('A'*40,'1')]:
   with self.assertRaises(ValueError): m.render(sha,issue)

 def test_status_binds_only_exact_workflow_commit(self):
  runs={'workflow_runs':[{'id':1,'head_sha':'c'*40,'head_branch':m.BRANCH,'event':'push'},
    {'id':2,'head_sha':COMMIT,'head_branch':m.BRANCH,'event':'push','status':'completed','conclusion':'success','html_url':'https://example/run/2'}]}
  def fake_api(path,token,method='GET',data=None):
   if '/contents/' in path: return {'content':__import__('base64').b64encode(m.render(SHA,'438').encode()).decode()}
   return runs
  with mock.patch.object(m,'api',side_effect=fake_api):
   found=m.find_run(COMMIT,SHA,'438','token')
  self.assertEqual(2,found['id'])

 def test_download_hashes_and_verifies_bound_artifact(self):
  raw=archive(); write=lambda artifact_id,token,path:(path.write_bytes(raw),(__import__('hashlib').sha256(raw).hexdigest(),len(raw)))[1]
  run={'id':2,'head_sha':COMMIT,'head_branch':m.BRANCH,'event':'push','status':'completed','conclusion':'success','html_url':'https://example/run/2'}
  def fake_api(path,token,method='GET',data=None):
   if '/contents/' in path: return {'content':__import__('base64').b64encode(m.render(SHA,'438').encode()).decode()}
   if '/workflows/' in path: return {'workflow_runs':[run]}
   return {'artifacts':[{'id':9,'name':m.artifact_name(SHA,'438'),'expired':False,'digest':'sha256:'+__import__('hashlib').sha256(raw).hexdigest()}]}
  with tempfile.TemporaryDirectory() as td, mock.patch.object(m,'load_token',return_value='token'), mock.patch.object(m,'api',side_effect=fake_api), mock.patch.object(m,'download_artifact_to_path',side_effect=write):
   dest=pathlib.Path(td)/'artifact.zip'; result=m.download(COMMIT,SHA,'438',dest)
   self.assertTrue(result['manifestVerified']); self.assertEqual(raw,dest.read_bytes()); self.assertEqual(64,len(result['sha256']))

 def test_failed_download_does_not_replace_destination(self):
  run={'id':2,'head_sha':COMMIT,'head_branch':m.BRANCH,'event':'push','status':'completed','conclusion':'success','html_url':'https://example/run/2'}
  def fake_api(path,token,method='GET',data=None):
   if '/contents/' in path: return {'content':__import__('base64').b64encode(m.render(SHA,'438').encode()).decode()}
   if '/workflows/' in path: return {'workflow_runs':[run]}
   return {'artifacts':[{'id':9,'name':m.artifact_name(SHA,'438'),'expired':False}]}
  def fail_download(artifact_id,token,path): path.write_bytes(b'partial'); raise RuntimeError('network failed')
  with tempfile.TemporaryDirectory() as td, mock.patch.object(m,'load_token',return_value='token'), mock.patch.object(m,'api',side_effect=fake_api), mock.patch.object(m,'download_artifact_to_path',side_effect=fail_download):
   dest=pathlib.Path(td)/'artifact.zip'; dest.write_bytes(b'old')
   with self.assertRaisesRegex(RuntimeError,'network failed'): m.download(COMMIT,SHA,'438',dest)
   self.assertEqual(b'old',dest.read_bytes()); self.assertEqual([],list(dest.parent.glob('*.tmp')))

 def test_manifest_only_is_rejected(self):
  raw=io.BytesIO()
  with zipfile.ZipFile(raw,'w') as z: z.writestr('ION-SOURCE-SHA.txt',SHA+'\n')
  with self.assertRaisesRegex(RuntimeError,'no non-empty supported'): m.verify_archive(raw.getvalue(),SHA)

 def test_workflow_content_accepts_github_line_wrapping(self):
  encoded=__import__('base64').b64encode(m.render(SHA,'438').encode()).decode()
  wrapped='\n'.join(encoded[i:i+60] for i in range(0,len(encoded),60))
  runs={'workflow_runs':[{'id':2,'head_sha':COMMIT,'head_branch':m.BRANCH,'event':'push'}]}
  def fake_api(path,token,method='GET',data=None):
   return {'content':wrapped} if '/contents/' in path else runs
  with mock.patch.object(m,'api',side_effect=fake_api):
   self.assertEqual(2,m.find_run(COMMIT,SHA,'438','token')['id'])

 def test_workflow_content_mismatch_is_rejected(self):
  with mock.patch.object(m,'api',return_value={'content':__import__('base64').b64encode(b'wrong').decode()}):
   with self.assertRaisesRegex(RuntimeError,'does not match'): m.find_run(COMMIT,SHA,'438','token')

 def test_manifest_mismatch_is_rejected_before_write(self):
  with self.assertRaisesRegex(RuntimeError,'manifest mismatch'): m.verify_archive(archive('c'*40),SHA)

if __name__=='__main__': unittest.main()
