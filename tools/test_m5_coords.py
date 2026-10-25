import json
import math
from pathlib import Path
import struct
import tempfile
import unittest
import subprocess
import sys

from emf_match import parse_html, predict
from m5_case_diff import compare
from m5_batch2_audit import regressions, coverage
from m5_coords import hint, path_value, coordinates, axis_direction


def point(x,y):return {'kind':'point','point':[x,y]}
def obj(c,parents=(),raw=b'',**kw):
    return {'constraint':c,'parents':list(parents),'constraintExtra':raw,**kw}
def unit(c,n):return obj(c,[1],struct.pack('<HHd',c,0,n))


class CoordinateHints(unittest.TestCase):
    def test_horizontal_unit_is_saved_pixels(self):
        self.assertEqual(hint(unit(52,20),[point(10,30)],[]),point(30,30))
    def test_square_unit_inherits_horizontal_scale_not_stale_own_value(self):
        parent=unit(52,20)
        self.assertEqual(hint(obj(54,[1],struct.pack('<HHd',54,0,37)),[point(30,30)],[parent]),point(10,10))
    def test_unit_unknown_layout_and_negative_fail_closed(self):
        for o in (unit(52,-1),unit(52,0),obj(52,raw=b'bad')):self.assertIsNone(hint(o,[point(0,0)],[]))
    def test_direction_both_layouts(self):
        self.assertEqual(axis_direction(obj(58,coordRecord=b'\1\0')),1)
        self.assertEqual(axis_direction(obj(58,coordRecord=b'\0\0\0\0')),0)
        self.assertIsNone(axis_direction(obj(58,coordRecord=b'\2\0')))
    def test_axis_rejects_unverified_oblique(self):
        self.assertIsNone(hint(obj(58,coordRecord=b'\1\0'),[point(0,0),point(10,2)],[]))
    def test_system_and_plot_inverse_with_unequal_units(self):
        k={'kind':'coordinate-system','origin':[100,200],'u':[20,0],'v':[0,-40]}
        self.assertEqual(coordinates([140,80],k),[2,3])
        n=lambda v:{'kind':'number','value':v,'dimension':'number'}
        self.assertEqual(hint(obj(69),[n(2),n(3),k],[]),point(140,80))
        self.assertAlmostEqual(hint(obj(86),[point(100,200),point(140,80),k],[])['value'],math.sqrt(13))
    def test_plot_refuses_unitful_coordinates(self):
        k={'kind':'coordinate-system','origin':[0,0],'u':[1,0],'v':[0,-1]}
        self.assertIsNone(hint(obj(69),[{'kind':'number','value':2,'dimension':'length'},{'kind':'number','value':3,'dimension':'number'},k],[]))
    def test_path_projection_clamp_and_circle_direction(self):
        for kind,want in [('line',-1),('segment',0),('ray',0)]:
            self.assertEqual(path_value([-10,3],{'kind':kind,'a':[0,0],'b':[10,0]}),want)
        self.assertEqual(path_value([0,-10],{'kind':'circle','center':[0,0],'radius':10}),.25)
        self.assertIsNone(path_value([0,0],{'kind':'circle','center':[0,0],'radius':10}))
    def test_unknown_path_and_missing_parent_fail_closed(self):
        self.assertIsNone(path_value([0,0],{'kind':'polygon'}))
        self.assertIsNone(hint(unit(52,20),[None],[]))
        self.assertIsNone(path_value([10,0],{'kind':'line','a':[0,0],'b':[20,0],'axisDirection':1}))
    def test_native_axis_path_basis_is_fixed_page_pixels_both_directions(self):
        objects=[{'objectIndex':1,'constraint':0,'mainKind':1,'parents':[],'savedPoint':[105,203]},
                 {'objectIndex':2,'mainKind':1,**unit(52,37.79527559055118)},
                 {'objectIndex':3,'mainKind':9,**obj(58,[1,2],coordRecord=b'\1\0\0\0')},
                 {'objectIndex':4,'mainKind':1,**obj(54,[2],struct.pack('<HHd',54,0,37.79527559055118))},
                 {'objectIndex':5,'mainKind':9,**obj(58,[1,4],coordRecord=b'\0\0\0\0')},
                 {'objectIndex':6,'mainKind':1,**obj(15,[3],struct.pack('<HHd',15,38,1.445))},
                 {'objectIndex':7,'mainKind':1,**obj(15,[5],struct.pack('<HHd',15,38,1.255))}]
        hints,_=predict(objects)
        self.assertEqual(hints[6],point(294,203));self.assertEqual(hints[7],point(105,354))
    def test_html_plot_parent_order(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'x.htm';path.write_text('{8} PlotXY(3,7,4)[black];\n',encoding='utf8')
            self.assertEqual(parse_html(path)['steps'][0]['parents'],[4,3,7])


class DiffTests(unittest.TestCase):
    def test_summary_does_not_call_a_blocked_page_all_assertions_passing(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'index.json').write_text(json.dumps({'cases':[{'case':'a.json'}]}))
            (root/'a.json').write_text(json.dumps({'source':{'path':'x.gsp'},'pageIndex':1,'assertions':[{'objectIndex':1,'kind':'measure','constraint':65}]}))
            (root/'report.json').write_text(json.dumps({'results':[{'source':'x.gsp','results':[{'objectIndex':1,'kind':'measure','passed':False,'category':'blocked_by_unimplemented_ancestor'}]}],
                                                      'passedChecks':0,'failedChecks':0,'blocked_by_unimplemented_ancestor':1,'categories':{'blocked_by_unimplemented_ancestor':1}}))
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('m5_batch1_summary.py')),'--index',str(root/'index.json'),'--report',str(root/'report.json'),'--out',str(root/'summary.json')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads((root/'summary.json').read_text())['files']['casesWithAllAssertionsPassing'],0)
    def test_regressions_preserve_previously_passed_geometry_and_readings(self):
        with tempfile.TemporaryDirectory() as folder:
            old,new=[Path(folder)/x for x in ('old.json','new.json')]
            rows=[{'objectIndex':1,'kind':'point','passed':True},{'objectIndex':2,'kind':'measure','passed':True}]
            base={'results':[{'source':'x.gsp','pageIndex':1,'results':rows}]}
            old.write_text(json.dumps(base));new.write_text(json.dumps(base))
            self.assertEqual(regressions(old,new)['regressionCount'],0)
            rows[1]['passed']=False;new.write_text(json.dumps(base))
            self.assertEqual(regressions(old,new)['regressionCount'],1)
    def test_coverage_counts_all_pages_once_and_active_pages_separately(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);index=root/'index.json'
            rows=[{'case':'a.json','source':{'path':'x.gsp'},'pageIndex':1},
                  {'case':'b.json','source':{'path':'x.gsp'},'pageIndex':2}]
            index.write_text(json.dumps({'cases':rows}))
            dump={'pages':[{'pageIndex':1,'objects':[{'constraintId':0,'status':'ok','exists':True}]},
                           {'pageIndex':2,'objects':[{'constraintId':94,'status':'unsupported','reason':'unverified'}]}]}
            for name in ('a.json','b.json'):(root/name).write_text(json.dumps(dump))
            r=coverage(index,root)
            self.assertEqual(r['allPageObjects'],2);self.assertEqual(r['objectOk'],1)
            self.assertEqual(r['activePagesFullySupported'],1)
    def test_unchanged_added_deleted_and_changed_are_separate(self):
        with tempfile.TemporaryDirectory() as folder:
            paths=[Path(folder)/x for x in ('old','new')]
            a=lambda i,v:{'objectIndex':i,'constraint':65,'kind':'measure','exists':True,'measurement':{'displayValue':v}}
            for path,assertions in zip(paths,([a(1,2),a(2,3)],[a(1,4),a(3,3)])):
                path.mkdir();(path/'index.json').write_text(json.dumps({'cases':[{'case':'a.json'}]}))
                (path/'a.json').write_text(json.dumps({'source':{'path':'x.gsp'},'pageIndex':1,'assertions':assertions,'excluded':[{'objectIndex':2,'reason':'ambiguous_primitives'}]}))
            r=compare(*paths)
            self.assertEqual(r['existingExpectedChanged'],1)
            self.assertEqual(sum(r['added'].values()),1);self.assertEqual(sum(r['deleted'].values()),1)
            self.assertEqual(r['deletedItems'][0]['reason'],'ambiguous_primitives')


if __name__=='__main__':unittest.main()
