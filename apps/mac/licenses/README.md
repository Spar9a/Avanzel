# Licence texts the app ships that no installed package carries

`scripts/licenses.mjs` puts every licence text the Mac app needs into its `Contents/Resources/licenses`. Most come
from the installed packages themselves. These come from here, because the onnxruntime-node and onnxruntime-common
packages on npm ship none:

- `onnxruntime-LICENSE.txt`: ONNX Runtime's MIT licence.
- `onnxruntime-ThirdPartyNotices.txt`: the notices of the components ONNX Runtime's library includes.

Both are copied unchanged from <https://github.com/microsoft/onnxruntime> at the tag `v1.30.0`, the version of
onnxruntime-node in `apps/mac/package.json`. Fetch them again when that version changes.

- `lazy-val-LICENSE.txt`: lazy-val, which electron-updater needs and the main process bundles, declares the MIT
  License in its package.json, but neither the package nor its repository has a licence file. This is the MIT
  License's text with its author's name.
