FROM docker.io/library/node:24-alpine
WORKDIR /gate
COPY gate.mjs .
USER node
EXPOSE 8080
CMD ["node", "gate.mjs"]
