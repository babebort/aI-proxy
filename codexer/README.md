**clone**
```shell
git clone https://github.com/vladvlsu/codexer
```
**build**
```shell
go build -o codexer .
```
**auth**
on the first run the auth flag will build the `config.yml` with auth data.
to get started you need to *COPY* the URL returned by codexer and paste it into your browser URL input. next you have to login.
if you see `failed to open page` error – this is expected result. go into the URL bar and copy the code after `=`: `callback?code=...`. paste the code to finish auth.

```shell
./codexer auth
```

**start server**
there are 2 modes for server: 
- single user
- multiuser

when you added just one acc - run the single user mode to test:

```shell
./codexer server --singleuser --gid {GID} --alias {USER}
```
after the cmd the server will be listening on `http://127.0.0.1:9090`. now you can test sending the request. openai and Ollama API schemas are supported:

```shell
curl \                                                   03:07:09 PM
-X POST \
-H "Content-type:application/json" \
-H "Authorization: Bearer {API}"  \
-d '{"model":"gpt-5.5","prompt":"hey"}' \
http://127.0.0.1:9090/api/v1/generate
```


