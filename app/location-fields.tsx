'use client';

import { useEffect, useState } from 'react';

type Country = { code: string; name: string };
type City = { id: string; name: string };
type Region = { id: string; code: string; name: string; cities: City[] };
type CountryLocations = Country & { regions: Region[] };

export default function LocationFields() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryCode, setCountryCode] = useState('');
  const [locations, setLocations] = useState<CountryLocations | null>(null);
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingCountries(true); setError('');
    fetch('/locations/countries.json', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Country[]>; })
      .then(data => { if (!controller.signal.aborted) setCountries(data); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load countries. Please try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingCountries(false); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!countryCode) return;
    const controller = new AbortController();
    setLoadingLocations(true); setError('');
    fetch(`/locations/${countryCode}.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<CountryLocations>; })
      .then(data => {
        if (controller.signal.aborted) return;
        setLocations(data);
        if (data.regions.length === 1) {
          setRegionId(data.regions[0].id);
          if (data.regions[0].cities.length === 1) setCityId(data.regions[0].cities[0].id);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load states and cities. Please try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingLocations(false); });
    return () => controller.abort();
  }, [countryCode, retry]);

  const country = countries.find(item => item.code === countryCode);
  const regions = locations?.code === countryCode ? locations.regions : [];
  const region = regions.find(item => item.id === regionId);
  const cities = region?.cities ?? [];
  const city = cities.find(item => item.id === cityId);
  const regionName = region?.id === 'none' ? '' : region?.name;
  const location = [city?.name, regionName, country?.name].filter(Boolean).join(', ');
  const compactLocation = [city?.name, region?.id === 'none' ? '' : region?.code || regionName, country?.code].filter(Boolean).join(', ');
  const savedLocation = location.length <= 100 ? location : compactLocation;
  const incomplete = Boolean(countryCode && (!locations || loadingLocations || error || (regions.length && !region) || (cities.length && !city)));

  return <>
    <label className="field"><span>Country</span>
      <select value={countryCode} disabled={loadingCountries} onChange={event => {
        setCountryCode(event.target.value); setLocations(null); setRegionId(''); setCityId(''); setError(''); setLoadingLocations(false);
      }}>
        <option value="">{loadingCountries ? 'Loading countries…' : 'Select country (optional)'}</option>
        {countries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select>
    </label>
    <div className="form-grid">
      <label className="field"><span>State / Province</span>
        <select value={regionId} disabled={!countryCode || loadingLocations || !regions.length} required={Boolean(countryCode && regions.length)} onChange={event => { setRegionId(event.target.value); setCityId(''); }}>
          <option value="">{!countryCode ? 'Select a country first' : loadingLocations ? 'Loading states / provinces…' : !regions.length ? 'No states / provinces listed' : 'Select state / province'}</option>
          {regions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="field"><span>City</span>
        <select value={cityId} disabled={!region || !cities.length} required={Boolean(cities.length)} onChange={event => setCityId(event.target.value)}>
          <option value="">{!region ? 'Select a state / province first' : !cities.length ? 'No cities listed' : 'Select city'}</option>
          {cities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>
    <input type="hidden" name="location_ready" value={incomplete ? 'false' : 'true'} />
    <input type="hidden" name="location" value={savedLocation} />
    {error && <p className="error" role="alert">{error} <button type="button" className="text-button" onClick={() => setRetry(retry + 1)}>Try again</button></p>}
    {loadingLocations && <p role="status">Loading location options…</p>}
    <p className="location-attribution">Location data: <a href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noreferrer">Countries States Cities Database</a> · <a href="/locations/ATTRIBUTION.txt" target="_blank" rel="noreferrer">ODbL attribution</a></p>
  </>;
}
