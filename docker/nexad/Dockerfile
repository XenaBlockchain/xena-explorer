FROM --platform=linux/amd64 ubuntu:20.04

RUN groupadd -r xena && useradd -r -m -g xena xena

RUN set -ex \
	&& apt-get update \
	&& apt-get install -qq --no-install-recommends ca-certificates dirmngr gosu wget \
	&& rm -rf /var/lib/apt/lists/*

ENV XENA_VERSION 1.4.0.1
ENV XENA_URL https://bitcoinunlimited.info/xena/1.4.0.1/xena-1.4.0.1-linux64.tar.gz
ENV XENA_SHA256 d57ba947edec39783681c776f2968bbde313398390256693d6df4e40bd01fc94

# install xena binaries
RUN set -ex \
	&& cd /tmp \
	&& wget -qO xena.tar.gz "$XENA_URL" \
	&& echo "$XENA_SHA256 xena.tar.gz" | sha256sum -c - \
	&& tar -xzvf xena.tar.gz -C /usr/local --strip-components=1 --exclude=*-qt \
	&& rm -rf /tmp/*

# create data directory
ENV XENA_DATA /data
RUN mkdir "$XENA_DATA" \
	&& chown -R xena:xena "$XENA_DATA" \
	&& ln -sfn "$XENA_DATA" /home/xena/.xena \
	&& chown -h xena:xena /home/xena/.xena
VOLUME /data

COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]


EXPOSE 7228 7227 7230 7229 20001 20002

CMD ["xenad"]
