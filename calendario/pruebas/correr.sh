#!/usr/bin/env bash
# Corre todas las suites de pruebas/ (archivos *.test.ts y *.test.mts), una tras otra, desde calendario/.
# Muestra OK o MAL por suite (con las líneas que no son OK de las que fallan) y sale con 1 si alguna falló.
#
#   bash pruebas/correr.sh            todas
#   bash pruebas/correr.sh google     sólo las que tienen "google" en la ruta
#   VER=1 bash pruebas/correr.sh      muestra la salida completa de cada suite
set -u
cd "$(dirname "$0")/.." || exit 1

filtro="${1:-}"
suites=()
while IFS= read -r s; do
  [[ -z "$filtro" || "$s" == *"$filtro"* ]] && suites+=("$s")
done < <(find pruebas -type f \( -name '*.test.ts' -o -name '*.test.mts' \) -not -path '*/node_modules/*' | LC_ALL=C sort)

if [[ ${#suites[@]} -eq 0 ]]; then
  echo "No hay suites${filtro:+ que calcen con «$filtro»}."
  exit 1
fi

# Límite por suite (si existe `timeout`, que en macOS no viene de fábrica).
limite=()
command -v timeout >/dev/null 2>&1 && limite=(timeout "${LIMITE:-900}")

fallaron=0
total_ok=0
total_mal=0
inicio=$SECONDS
for s in "${suites[@]}"; do
  t0=$SECONDS
  salida=$("${limite[@]}" node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs "$s" 2>&1)
  codigo=$?
  n_ok=$(grep -c '^OK' <<<"$salida")
  n_mal=$(grep -c '^MAL' <<<"$salida")
  total_ok=$((total_ok + n_ok))
  total_mal=$((total_mal + n_mal))
  dur=$((SECONDS - t0))
  if [[ $codigo -eq 0 && $n_mal -eq 0 && $n_ok -gt 0 ]]; then
    echo "OK  $s  ($n_ok OK, ${dur}s)"
    [[ -n "${VER:-}" ]] && sed 's/^/    /' <<<"$salida"
  else
    fallaron=1
    motivo="código $codigo"
    [[ $codigo -eq 124 ]] && motivo="se pasó del límite de tiempo"
    [[ $n_ok -eq 0 && $n_mal -eq 0 ]] && motivo="$motivo, sin resultados"
    echo "MAL $s  ($n_ok OK, $n_mal MAL, $motivo, ${dur}s)"
    if [[ -n "${VER:-}" ]]; then
      sed 's/^/    /' <<<"$salida"
    else
      grep -v '^OK' <<<"$salida" | sed '/^[[:space:]]*$/d; s/^/    /' | head -60
    fi
  fi
done
echo "— ${#suites[@]} suites, $total_ok OK, $total_mal MAL, $((SECONDS - inicio))s"
exit $fallaron
