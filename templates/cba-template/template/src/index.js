import http from 'http';

const requestListener = (req, res) => {
	res.writeHead(200);
	res.end('Babel.JS is working!');
};

const server = http.createServer(requestListener);
server.listen(8080);
