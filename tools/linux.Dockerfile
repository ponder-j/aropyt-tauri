FROM node:22-bookworm-slim AS node
FROM rust:1-bookworm
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources && apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev pkg-config patchelf xvfb xauth dbus-x11 fonts-noto-cjk pandoc poppler-utils file desktop-file-utils && apt-get clean
COPY --from=node /usr/local/ /usr/local/
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run typecheck
ENV CARGO_TARGET_DIR=/cargo-target
CMD ["sh", "-c", "cargo build --manifest-path src-tauri/Cargo.toml --locked && WEBKIT_DISABLE_COMPOSITING_MODE=1 dbus-run-session -- xvfb-run -a npm test"]
