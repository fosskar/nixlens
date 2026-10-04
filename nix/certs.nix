# openssl scripts for the nos ca and the per-machine certificates, shared by
# the clan service's vars generators and the vm test. they follow the vars
# generator contract: inputs under $in/<generator>, outputs into $out
{ lib }:
{
  ca = ''
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
      -days 3650 -subj "/CN=nos" -keyout "$out/ca.key" -out "$out/ca.crt"
  '';

  # usage is the certificate's only extended key usage: serverAuth for
  # agents, clientAuth for the hub
  cert =
    {
      name,
      usage,
      sans ? [ ],
    }:
    ''
      openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
        -subj "/CN=${name}" -keyout "$out/key.pem" -out csr.pem
      cat > ext.cnf <<EXT
      extendedKeyUsage=${usage}
      ${lib.optionalString (sans != [ ])
        "subjectAltName=${lib.concatMapStringsSep "," (s: "DNS:${s}") sans}"
      }
      EXT
      openssl x509 -req -in csr.pem -days 3650 \
        -CA "$in/nos-ca/ca.crt" -CAkey "$in/nos-ca/ca.key" \
        -set_serial "0x$(openssl rand -hex 16)" -extfile ext.cnf \
        -out "$out/cert.pem"
    '';
}
