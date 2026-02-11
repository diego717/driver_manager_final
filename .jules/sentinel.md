## 2025-05-22 - [Timing Attack in Legacy Auth]
**Vulnerability:** A timing attack was possible in the legacy password verification method because it used a standard equality operator (`==`) to compare the calculated PBKDF2 hash with the stored hash.
**Learning:** Even legacy code paths can introduce vulnerabilities if they remain accessible. Standard string comparison is not constant-time and can leak information about the hash.
**Prevention:** Always use `hmac.compare_digest` for comparing hashes or any sensitive tokens.
