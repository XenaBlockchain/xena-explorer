# XENA RPC Explorer
 
Simple, database-free* Xena blockchain explorer, via RPC. Built with Node.js, express, bootstrap-v4.

This tool is intended to be a simple, self-hosted explorer for the Xena blockchain, driven by RPC calls to your own xenad node. This tool is easy to run but currently lacks features compared to database-backed explorers.

Whatever reasons one might have for running a full node (trustlessness, technical curiosity, supporting the network, etc) it's helpful to appreciate the "fullness" of your node. With this explorer, you can not only explore the blockchain (in the traditional sense of the term "explorer"), but also explore the functional capabilities of your own node.

# Features

* Network Summary "dashboard"
* View details of blocks, transactions, and addresses
* Analysis tools for viewing stats on blocks, transactions, and miner activity
* View JSON content used to generate most pages
* Search by transaction ID, block hash/height, and address
* Optional transaction history for addresses by querying from ElectrumX (titan)
* Txpool summary, with fee, size, and age breakdowns
* RPC command browser and terminal

# Changelog / Release notes

See [CHANGELOG.md](/CHANGELOG.md).

# Getting started

The below instructions are geared toward XENA, but can be adapted easily to other coins.

## Prerequisites

1. Install and run a full, archiving node - [instructions](https://www.xenablockchain.com/download). Ensure that your xena node has full transaction indexing enabled (`txindex=1`) and the RPC server enabled (`server=1`) adding the flags into the xena executable.
2. Synchronize your node with the XENA network.
3. Install and set up a redis server instance, which is mandatory to run the explorer (see /docs/server-setup.md for more details)
3. Run xena-rpc-explorer passing the cookie route based on the defined path to store files download with Xena full node. (Check cli arguments section)
4. Node.js has to be version >= 22.
4. You could also run an [Titan](https://gitlab.com/xena/titan) and configure the explorer to received data from it (optional)

## Instructions

```bash
npm install -g xena-rpc-explorer
xena-rpc-explorer
```

If you're running on mainnet with the default datadir and port, this Should Just Work.
Open [http://127.0.0.1:3002/](http://127.0.0.1:3002/) to view the explorer.

You may set configuration options in a `.env` file or using CLI args.
See [configuration](#configuration) for details.

## Token indexing

After installing you need to install sequelize cli and migrate the database schema for indexing of tokens.

```bash
npm install -g sequelize-cli
```

Migrate the tables:

```bash
npx sequelize-cli db:migrate
```

This will start indexing the tokens on the xena network.

Anytime you pull develop or a branch that is being update you should run the migrate function above to make sure you
have all the latest tables.

The schema is located in [schema.png](/docs/schema.png).


### Configuration

Configuration options may be passed as environment variables
or by creating an env file at `~/.config/xena-rpc-explorer.env`
or at `.env` in the working directory.
See [.env-sample](.env-sample) for a list of the options and details for formatting `.env`.

You may also pass options as CLI arguments, for example:

```bash
UNIX
xena-rpc-explorer --port 8080 --xenad-port 18332 --xenad-cookie ~/.xena/regtes/:nqtsq5g5wtkt44pfqusjj3wulk2n2pd27lhpzg0m326kcnsj.cookie

WINDOWS
xena-rpc-explorer --xenad-cookie C:\your-xenad-path\.cookie
```

See `xena-rpc-explorer --help` for the full list of CLI options.

## Run via Docker

1. `docker build -t xena-rpc-explorer .`
2. `docker run -p 3002:3002 -it xena-rpc-explorer`

 
 

