## Morningstar Static Resource CDN
---
## Get started

```
npm i
```

## Configurations
* -v verbose logging
* -o offline when running bower install. used for development only.
* -r resolve mode. Writing version resolve to system output. //TODO: version resolution is not implemented yet.
* -s server mode. An Express server will be started to act as a dependency bundler
* default without -o -s publish mode

_-v could be used with -o or -s or solely which is publish mode_


## Publish
```
./index.js  sal-components-gmb#1.0.9  -v
```

## Resolve
```
./index.js  sal-components-gmb#1.0.9  -rv
```

## Serve
`./index.js -sv`

or

`export port=43433; npm start`


## Browser shim

```
http://localhost:8868/q/sal-components-valuation:0.0.9,foundation:5.5.2,bootstrap:3.3.5,d3:3.3.5/shim/%7B%22jquery%22%3A%221.11.1%22,%22d3%22%3A%223.3.5%22%7D
```

