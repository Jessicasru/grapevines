import { useState } from "react";
import { ChevronDown, Globe2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { wineCountries, type MapLocation } from "@/lib/wine-countries";
import type { Region } from "@/lib/wine";

export function RegionSelector({ regions, location, onSelect }: { regions: Region[]; location: MapLocation; onSelect: (value: MapLocation) => void }) {
  const [open, setOpen] = useState(false);
  const label = location.kind === "country" ? location.name : location.kind === "region" ? regions.find((r) => r.id === location.id)?.name ?? "Wine regions" : "Wine regions";
  const select = (value: MapLocation) => { onSelect(value); setOpen(false); };
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <Button variant="secondary" role="combobox" aria-expanded={open} aria-label="Choose country or wine region" className="h-9 w-[8.5rem] justify-between gap-1 rounded-full px-3 lg:h-11 lg:w-56"><span className="truncate">{label}</span><ChevronDown className="size-4 shrink-0" /></Button>
  </PopoverTrigger><PopoverContent align="start" className="w-72 max-w-[calc(100vw-32px)] p-0 shadow"><Command>
    <CommandInput placeholder="Search countries and regions…" aria-label="Search countries and regions" />
    <CommandList><CommandEmpty>No locations found.</CommandEmpty>
    {wineCountries(regions).map((country) => <CommandGroup key={country.name} heading={country.name}>
      <CommandItem value={country.name} onSelect={() => select({ kind: "country", name: country.name })}><Globe2 />{country.name}</CommandItem>
      {country.regions.map((region) => <CommandItem className="pl-7" key={region.id} value={`${country.name} ${region.name}`} onSelect={() => select({ kind: "region", id: region.id })}><MapPin />{region.name}</CommandItem>)}
    </CommandGroup>)}</CommandList>
  </Command></PopoverContent></Popover>;
}