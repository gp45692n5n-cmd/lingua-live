# Security Policy

Please do not open public issues for vulnerabilities, exposed API keys or unsafe local-service behavior. Use GitHub's private vulnerability reporting feature when it is enabled for the repository.

Lingua Live binds its local backend to `127.0.0.1`. Cloud API keys must be supplied through environment variables and must never be committed. Captured audio is processed locally unless a configured translation provider receives recognized text.
