from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return response
    detail = response.data.get("detail") if isinstance(response.data, dict) else response.data
    response.data = {
        "error": {
            "code": getattr(exc, "default_code", "request_error"),
            "message": str(detail) if detail is not None else "The request could not be completed.",
            "details": response.data,
        }
    }
    return response
