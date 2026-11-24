"""Extract only physics dimensions, avoiding diagnostic topology in JS bundles."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
for model in ['model3','model-y']:
 data=json.loads((root/'public/models'/f'{model}-geometry.json').read_text())
 result={key:data[key] for key in ['wheelbase','frontTrack','rearTrack']}
 result['wheels']=[{key:wheel[key] for key in ['id','center','radius','width']} for wheel in data['wheels']]
 (root/'public/models'/f'{model}-chassis-geometry.json').write_text(json.dumps(result,indent=2)+'\n')
