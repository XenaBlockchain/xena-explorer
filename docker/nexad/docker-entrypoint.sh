#!/bin/bash
set -e

if [[ "$1" == "xena-cli" || "$1" == "xena-tx" || "$1" == "xenad" || "$1" == "test_xena" ]]; then
  mkdir -p "$XENA_DATA"

  if [[ ! -s "$XENA_DATA/xena.conf" ]]; then
    cat <<EOF > "$XENA_DATA/xena.conf"
	  txindex=1
    printtoconsole=1
	  electrum=1
    rpcallowip=::/0
    rpcpassword=${XENA_RPC_PASSWORD:-explorer}
    rpcuser=${XENA_RPC_USER:-explorer}
EOF
    chown xena:xena "$XENA_DATA/xena.conf"
  fi

  # ensure correct ownership and linking of data directory
  # we do not update group ownership here, in case users want to mount
  # a host directory and still retain access to it
  chown -R xena "$XENA_DATA"
  ln -sfn "$XENA_DATA" /home/xena/.xena
  chown -h xena:xena /home/xena/.xena

  exec gosu xena "$@"
fi

exec "$@"
