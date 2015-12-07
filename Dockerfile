FROM node:0.12
MAINTAINER pwang2@live.com

COPY ./  /data/brower/

WORKDIR /data/brower

RUN npm install -g pm2 --no-optional && \
npm install --no-optional && \
mkdir -p /data/cdn && \
git config --global url."https://".insteadOf git://

VOLUME /data/cdn
ENV CDN_PHYSICAL_PATH="/data/cdn"

ENTRYPOINT ["pm2"]
CMD ["start", "processes.json", "--no-daemon"]



