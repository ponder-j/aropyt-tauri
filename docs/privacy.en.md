[中文](privacy.md) | [English](privacy.en.md)

# Aropyt Privacy Notice

Documents, preferences, recovery drafts, themes, dictionaries, and learned words are stored locally. The application has no telemetry, accounts, commercial licensing service, or automatic update service.

Spell check is off by default, and dictionaries are not installed by default. If you choose to download a dictionary, the application requests only that language's dictionary from the fixed jsDelivr / GitHub raw-file addresses in its manifest. Checking and language detection run locally; document content is not uploaded. You can also import local Hunspell dictionaries entirely offline.

Remote images in documents request resources from their respective servers. When you use image upload, selected images are passed to the PicGo, PicList, or upload command you configured. Import and Pandoc export run locally. External links open in the default browser.

On first launch, data from the old version is copied to a separate new directory; the original data remains intact. Automated tests use isolated directories.
