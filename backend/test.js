const regex = /'(%?):([a-zA-Z0-9_]+)(%?)'/g;
const inputs = [
  "like '%:nombre%'",
  "like N'%:nombre%'",
  "like '%:nombre'",
  "like ':nombre%'",
  "like '%:nombre_empresa%'",
  "like '%:NOMBRE%'",
  "like '%:nombre %'"
];
for (const input of inputs) {
  console.log(input, '->', input.replace(regex, 'MATCHED'));
}
