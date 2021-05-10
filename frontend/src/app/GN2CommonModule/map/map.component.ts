import { Component, Input, OnInit, ViewChild, Injectable } from '@angular/core';
import { MapService } from './map.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Map, LatLngExpression } from 'leaflet';
import { AppConfig } from '@geonature_config/app.config';
import { HttpClient, HttpParams } from '@angular/common/http';
import * as L from 'leaflet';
import { CommonService } from '../service/common.service';
import { DataFormService } from '../form/data-form.service';

import 'leaflet-draw';
import { FormControl } from '@angular/forms';
import { Observable, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  tap,
  switchMap,
  map,
  timeout
} from 'rxjs/operators';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const PARAMS = new HttpParams({
  fromObject: {
    format: 'json',
    limit: '10',
    polygon_geojson: '1'
  }
});

@Injectable()
export class NominatimService {
  constructor(private http: HttpClient) { }

  search(term: string) {
    if (term === '') {
      return of([]);
    }

    return this.http.get(NOMINATIM_URL, { params: PARAMS.set('q', term) }).pipe(map(res => res));
  }
}

/**
 * Ce composant affiche une carte Leaflet ainsi qu'un outil de recherche de lieux dits et d'adresses (basé sur l'API OpenStreetMap).
 * @example
 * <pnx-map height="80vh" [center]="center" [zoom]="zoom" > </pnx-map>`
 */
@Component({
  selector: 'pnx-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
  providers: [NominatimService]
})
export class MapComponent implements OnInit {
  /**
   *  coordonnées du centrage de la carte: [long,lat]
   */
  @Input() center: Array<number>;
  /** Niveaux de zoom à l'initialisation de la carte */
  @Input() zoom: number = AppConfig.MAPCONFIG.ZOOM_LEVEL;
  /** Hauteur de la carte (obligatoire) */
  @Input() height: string;
  /** Activer la barre de recherche */
  @Input() searchBar: boolean = true;

  @ViewChild('mapDiv') mapContainer;
  searchLocation: string;
  public searching = false;
  public searchFailed = false;
  public locationControl = new FormControl();
  public map: Map;
  public dictAreasColors: any;
  public listDefaultColors: Array<any>;
  public areaTypes: Array<any>;
  public currentLayers: Array<any>;
  public stationsgeoJson: L.GeoJSON;
  public areasgeoJson: L.GeoJSON;
  public featuresAreas: any;
  constructor(
    private mapService: MapService,
    private _commonService: CommonService,
    private _gnDataService: DataFormService,
    private _http: HttpClient,
    private _nominatim: NominatimService,
  ) {
    this.searchLocation = '';
  }

  ngOnInit() {
    this.initialize();
  }


  search = (text$: Observable<string>) =>
    text$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      tap(() => (this.searching = true)),
      switchMap(term =>
        this._nominatim.search(term).pipe(
          tap(() => (this.searchFailed = false)),
          catchError(() => {
            this._commonService.translateToaster('Warning', 'Map.LocationError');
            this.searchFailed = true;
            return of([]);
          })
        )
      ),
      tap(() => (this.searching = false))
    );

  onResultSelected(nomatimObject) {
    const geojson = L.geoJSON(nomatimObject.item.geojson);
    this.map.fitBounds(geojson.getBounds());
  }

  initialize() {
    let center: LatLngExpression;
    if (this.center !== undefined) {
      center = L.latLng(this.center[0], this.center[1]);
    } else {
      center = L.latLng(AppConfig.MAPCONFIG.CENTER[0], AppConfig.MAPCONFIG.CENTER[1]);
    }

    // Personalize the default colors for the loaded area types
    this.listDefaultColors = ["#6B8E23", "#8B0000", "#FF8C00", "#800080", "#4682B4"];

    const map = L.map(this.mapContainer.nativeElement, {
      zoomControl: false,
      center: center,
      zoom: this.zoom,
      preferCanvas: true
    });
    this.map = map;
    (map as any)._onResize();

    L.control.zoom({ position: 'topright' }).addTo(map);
    const baseControl = {};
    const BASEMAP = JSON.parse(JSON.stringify(AppConfig.MAPCONFIG.BASEMAP));

    BASEMAP.forEach((basemap, index) => {
      const formatedBasemap = this.formatBaseMapConfig(basemap);
      if (basemap.service === 'wms') {
        baseControl[formatedBasemap.name] = L.tileLayer.wms(
          formatedBasemap.url,
          formatedBasemap.options
        );
      } else {
        baseControl[formatedBasemap.name] = L.tileLayer(
          formatedBasemap.url,
          formatedBasemap.options
        );
      }
      if (index === 0) {
        map.addLayer(baseControl[basemap.name]);
      }
    });
    this.mapService.layerControl = L.control.layers(baseControl);
    this.mapService.layerControl.addTo(map);
    L.control.scale().addTo(map);

    this.mapService.setMap(map);
    this.mapService.initializeLeafletDrawFeatureGroup();


    map.on('moveend', e => {
      this.mapService.currentExtend = {
        center: this.map.getCenter(),
        zoom: this.map.getZoom()
      };
      this.addCurrentFeatures();
    });

    this.currentLayers = [];
    this._gnDataService.getAreaTypes().subscribe(data => {
      this.areaTypes = data;
    });
    this.dictAreasColors = {};
  }

  fetchTypesAreas(typeId, event) {
    const zoomMin = this.areaTypes.find(t => t.id_type == typeId)['zoom_min'];
    if (this.map.getZoom() >= zoomMin || zoomMin === undefined) {
      this._gnDataService.getAreas([typeId], undefined, 100000, true).subscribe(geojsonAreas => {
        if (event.checked) {
          // If checkbox checked, we add to related data to the currentLayers list
          const layer = [];
          geojsonAreas.forEach(area => {
            layer.push(area.geojson_4326);
          });
          this.currentLayers.push({idDB : typeId, data : layer});
        } else {
          // If the checkbox is unchecked, we find the related data in the currentLayers list and we remove it
          const indexArea = this.currentLayers.findIndex(dict => dict.idDB === typeId);
          this.currentLayers.splice(indexArea, 1);
        }

        this.addCurrentFeatures();
      });
    } else {
      if (event.checked) {
        this._commonService.translateToaster(
          "warning",
          "Affichage indisponible pour ce niveau de zoom."
        );
      }
    }
  }

  addCurrentFeatures() {
    // We start a new featureCollection that will contain all the selected features
    const featureCollection = {
      type: 'FeatureCollection',
      features: []
    };

    // We add all the features contained in the currentStations list, in the featureCollection
    this.currentLayers.forEach(feature => {
      const color = this.assignColorToArea(feature);

      feature.data.forEach(layer => {
        if(this.getLayerBoundings(layer)) {
          // If the layer is within the actual bounding box, we add it to the list of features to display
          featureCollection.features.push({'type' : 'Feature', 'geometry' : JSON.parse(layer),
            properties: {
              name: 'Multipolygon',
              style: {
                color: color,
                opacity: 0.4,
                fillColor: color,
                fillOpacity: 0.1,
                smoothFactor: 0.1
              }
            }
          });
        }
      });
    });

    this.featuresAreas = featureCollection;

    this.setAreasOnLayers();
  }

  assignColorToArea(feature) {
    // Define the color to assign to the area
    let color = '';
    if (feature.idDB in this.dictAreasColors) {
      // If area already set we reaload its color
      color = this.dictAreasColors[feature.idDB];
    } else {
      // If area is new
      this.listDefaultColors.forEach(defaultColor => {
        if (Object.values(this.dictAreasColors).indexOf(defaultColor) < 0 && color === '') {
          // If a color in the default color list is unset, we use it
          color = defaultColor;
          this.dictAreasColors[feature.idDB] = color;
        }
      });
      if (color === '') {
        // If no color are unused in the default list, we generate a random one
        color = '#' + (0x1000000 + (Math.random()) * 0xffffff).toString(16).substr(1, 6);
        this.dictAreasColors[feature.idDB] = color;
      }
    }
    return color;
  }

  getLayerBoundings(layer) {
    // Define if the layer is present within the actual bounding box
    const coordinates = JSON.parse(layer).coordinates[0][0];
    const layerMinLat = Math.min.apply(Math, coordinates.map(function(o) { return o[1]; }));
    const layerMaxLat = Math.max.apply(Math, coordinates.map(function(o) { return o[1]; }));
    const layerMinLng = Math.min.apply(Math, coordinates.map(function(o) { return o[0]; }));
    const layerMaxLng = Math.max.apply(Math, coordinates.map(function(o) { return o[0]; }));
    const layerBounds = L.latLngBounds(L.latLng(layerMinLat, layerMinLng), L.latLng(layerMaxLat, layerMaxLng));
    return this.map.getBounds().contains(layerBounds) || this.map.getBounds().intersects(layerBounds);
  }

  setAreasOnLayers() {
    if (this.areasgeoJson) {
      this.mapService.map.removeLayer(this.areasgeoJson);
    }

    this.areasgeoJson = this.mapService.L.geoJSON(this.featuresAreas, {
      style: feature => {
        return feature.properties.style;
      }
    });

    this.areasgeoJson.addTo(this.mapService.map);

    setTimeout(() => {
      this.map.invalidateSize();
    }, 50);

  }

  /** Retrocompatibility hack to format map config to the expected format:
   *
   {
    name: string,
    url: string,
    service?: wms|wmts|null
    options?: {
        layer?: string,
        attribution?: string,
        format?: string
        [...]
    }
  }
   */
  formatBaseMapConfig(baseMap) {
    // tslint:disable-next-line:forin
    for (let attr in baseMap) {
      if (attr === 'layer') {
        baseMap['url'] = baseMap[attr];
        delete baseMap['layer'];
      }
      if (!['url', 'layer', 'name', 'service', 'options'].includes(attr)) {
        if (!baseMap['options']) {
          baseMap['options'] = {};
        }
        baseMap['options'][attr] = baseMap[attr];
        delete baseMap[attr];
      }
    }
    return baseMap;
  }

  formatter(nominatim) {
    return nominatim.display_name;
  }
}
