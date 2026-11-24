import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

// Public geographical data only. Never send application configuration upstream.
const version = 'v5.2.0-export.1';
const repository = 'https://github.com/dr5hn/countries-states-cities-database';
const asset = `${repository}/releases/download/${version}/json-countries%2Bstates%2Bcities.json.gz`;
const output = new URL('../public/locations/', import.meta.url);
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Location download failed: ${response.status}`);
  return response;
}
const response = await download(asset);
const data = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'));
if (!Array.isArray(data) || data.length < 200) throw new Error('Invalid country dataset.');
const sortByName = (a, b) => a.name.localeCompare(b.name, 'en');
const cities = entries => (entries ?? []).map(city => ({ id: String(city.id), name: city.name })).sort(sortByName);
const countries = [];
let cityCount = 0;
await mkdir(output, { recursive: true });
for (const country of data) {
  if (!/^[A-Z]{2}$/.test(country.iso2)) throw new Error('Invalid country code.');
  const regions = (country.states ?? []).map(state => ({
    id: String(state.id), code: state.iso2 ?? '', name: state.name, cities: cities(state.cities),
  })).sort(sortByName);
  if (country.cities?.length) regions.push({ id: 'none', code: '', name: 'Not applicable', cities: cities(country.cities) });
  cityCount += regions.reduce((total, region) => total + region.cities.length, 0);
  countries.push({ code: country.iso2, name: country.name });
  await writeFile(new URL(`${country.iso2}.json`, output), JSON.stringify({ code: country.iso2, name: country.name, regions }) + '\n');
}
await writeFile(new URL('countries.json', output), JSON.stringify(countries.sort(sortByName)) + '\n');
const attribution = `Location data derived from Countries States Cities Database by dr5hn and contributors.\nSource: ${repository}\nRelease: ${version}\nDownload: ${asset}\nLicense: Open Database License (ODbL) v1.0.\nThe derived JSON files in this directory are available under the same license.\nAdaptations: retain country codes/names and region/city IDs/names; group and sort by country/region.\nThese geographical data terms do not license the application's inventory records.\n`;
await writeFile(new URL('ATTRIBUTION.txt', output), attribution);
const license = await download(`https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/${version}/LICENSE`);
await writeFile(new URL('LICENSE.txt', output), (await license.text()).replace(/[ \t]+$/gm, ''));
console.log(JSON.stringify({ countries: countries.length, cities: cityCount, version }));
