"""
Shared password policy for desktop and setup flows.
"""

from __future__ import annotations

import re


class PasswordPolicy:
    """Single source of truth for password requirements."""

    MIN_LENGTH = 12
    REQUIRE_UPPER = True
    REQUIRE_LOWER = True
    REQUIRE_DIGIT = True
    REQUIRE_SPECIAL = True
    SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?"
    MIN_SCORE = 50

    @classmethod
    def describe_requirements(cls) -> str:
        return (
            f"Minimo {cls.MIN_LENGTH} caracteres con al menos una mayuscula, "
            "una minuscula, un numero y un caracter especial."
        )

    @classmethod
    def analyze(cls, password: str, username: str = "") -> dict:
        """Analyze password quality and return validation details."""
        candidate = password or ""
        normalized_username = (username or "").strip().lower()
        errors: list[str] = []
        score = 0

        if len(candidate) < cls.MIN_LENGTH:
            errors.append(f"Debe tener al menos {cls.MIN_LENGTH} caracteres")
        else:
            score += 20
            if len(candidate) >= 16:
                score += 10
            if len(candidate) >= 20:
                score += 10

        if cls.REQUIRE_UPPER:
            if not re.search(r"[A-Z]", candidate):
                errors.append("Debe contener al menos una letra mayuscula")
            else:
                score += 15

        if cls.REQUIRE_LOWER:
            if not re.search(r"[a-z]", candidate):
                errors.append("Debe contener al menos una letra minuscula")
            else:
                score += 15

        if cls.REQUIRE_DIGIT:
            if not re.search(r"\d", candidate):
                errors.append("Debe contener al menos un numero")
            else:
                score += 15

        if cls.REQUIRE_SPECIAL:
            if not re.search(f"[{re.escape(cls.SPECIAL_CHARS)}]", candidate):
                errors.append(
                    f"Debe contener al menos un caracter especial ({cls.SPECIAL_CHARS[:10]}...)"
                )
            else:
                score += 15

        if normalized_username and normalized_username in candidate.lower():
            errors.append("No debe contener el nombre de usuario")
            score -= 20

        weak_patterns = [
            (r"(.)\1{2,}", "No debe tener caracteres repetidos consecutivos (AAA, 111)"),
            (r"(012|123|234|345|456|567|678|789|890)", "No debe contener secuencias numericas simples"),
            (
                r"(abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)",
                "No debe contener secuencias alfabeticas simples",
            ),
            (
                r"(password|contrasena|contraseña|admin|user|login|welcome|qwerty|asdfgh)",
                "No debe contener palabras comunes",
            ),
        ]
        for pattern, message in weak_patterns:
            if re.search(pattern, candidate.lower()):
                errors.append(message)
                score -= 15

        unique_chars = len(set(candidate))
        if candidate and unique_chars < len(candidate) * 0.6:
            errors.append("La contrasena debe tener mayor diversidad de caracteres")
            score -= 10
        elif candidate:
            score += 10

        final_score = max(0, min(100, score))
        is_valid = len(errors) == 0 and final_score >= cls.MIN_SCORE

        if errors:
            message = "Contrasena no cumple con los requisitos:\n- " + "\n- ".join(errors)
        else:
            strength = "Debil" if final_score < 60 else "Media" if final_score < 80 else "Fuerte"
            message = f"Contrasena valida. Fortaleza: {strength} ({final_score}/100)"

        return {
            "is_valid": is_valid,
            "message": message,
            "score": final_score,
            "errors": errors,
        }

    @classmethod
    def validate(cls, password: str, username: str = "") -> tuple[bool, str]:
        result = cls.analyze(password, username=username)
        return result["is_valid"], result["message"]

    @classmethod
    def validate_with_score(cls, password: str, username: str = "") -> tuple[bool, str, int]:
        result = cls.analyze(password, username=username)
        return result["is_valid"], result["message"], result["score"]
