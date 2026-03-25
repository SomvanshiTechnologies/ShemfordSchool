// Initialise MongoDB as a single-node replica set so multi-document
// transactions work in the Docker environment.
rs.initiate({
  _id: "rs0",
  members: [{ _id: 0, host: "mongo:27017" }]
});
