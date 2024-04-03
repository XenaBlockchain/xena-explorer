
FROM node:21-alpine3.18

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
RUN apk add --no-cache git
RUN git config --global --add safe.directory /home/node/app
WORKDIR /home/node/app

COPY package*.json ./

USER node

RUN npm install

COPY --chown=node:node . .

EXPOSE 3002

CMD [ "npm", "start" ]
