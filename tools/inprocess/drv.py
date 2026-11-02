import base64, importlib.abc, importlib.util, json, os, sys

blob = json.load(sys.stdin)
SRC = {k: base64.b64decode(v).decode() for k, v in blob["app"].items()}
os.environ["HUB_APP_GOOGLE_SA_FILES"] = ""
os.environ["HUB_APP_GOOGLE_OWNER_FILE"] = ""
for k, v in (blob.get("env") or {}).items():
    os.environ[k] = v
if os.path.isdir("/tmp/oxl"):
    sys.path.append("/tmp/oxl")


class Loader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        return importlib.util.spec_from_loader(name, self) if name in SRC else None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = "/app/" + module.__name__ + ".py"
        exec(compile(SRC[module.__name__], module.__file__, "exec"), module.__dict__)


sys.meta_path.insert(0, Loader())
CREDS = blob.get("creds") or {}
exec(compile(blob["code"], "probe", "exec"))
