"""Expose the dashboard Flask application module lazily for tests."""

_app_module = None
_app_import_error = None

try:
    from . import app as _loaded_app
except ModuleNotFoundError as exc:
    _app_import_error = exc
else:
    _app_module = _loaded_app


def __getattr__(name):
    if name == "app":
        if _app_import_error is not None:
            raise _app_import_error
        return _app_module
    raise AttributeError(name)
