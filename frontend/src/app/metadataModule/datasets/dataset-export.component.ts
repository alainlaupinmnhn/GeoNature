import {
  Component,
  ElementRef,
  Inject,
  OnInit,
  Renderer2,
  ViewChild
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DataFormService } from '@geonature_common/form/data-form.service';
import { BaseChartDirective } from 'ng2-charts';
import 'chartjs-plugin-labels';
import { AppConfig } from '@geonature_config/app.config';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { DOCUMENT } from '@angular/common';

@Component({
  selector: 'pnx-dataset-export',
  templateUrl: './dataset-export.component.html',
  styleUrls: ['/dataset-card.scss', '../metadata_pdf.css']
})
export class DatasetExportComponent implements OnInit {
  public id_dataset: number;
  public dataset: any;
  public geojsonData: any = null;
  public acquisitionFrameworks: any;
  public pdfName: string;
  // Titre
  public pdfClosedTitle: string;
  public pdfTitle: string;
  // Etiquettes
  public logo: string;
  public bandeau: string;
  public entite: string;
  // Footer
  public footerUrl: string;
  public footerDate: Date;
  public pdfDate: Date;
  @ViewChild(BaseChartDirective) chart: BaseChartDirective;
  // Type de graphe
  public pieChartType = 'doughnut';
  // Tableau contenant les labels du graphe
  public pieChartLabels = [];
  // Tableau contenant les données du graphe
  public pieChartData = [];
  // Tableau contenant les couleurs et la taille de bordure du graphe
  public pieChartColors = [];
  // Dictionnaire contenant les options à implémenter sur le graphe (calcul des pourcentages notamment)
  public pieChartOptions = {
    cutoutPercentage: 30,
    animation: {
      duration: 0
    },
    elements: {
      arc: {
        borderWidth: 0
      }
    },
    legend: {
      display: 'true',
      position: 'left',
      labels: {
        fontSize: 15,
        filter: function(legendItem, chartData) {
          return chartData.datasets[0].data[legendItem.index] != 0;
        }
      }
    },
    plugins: {
      labels: [
        {
          render: 'percentage',
          fontColor: 'blackgray',
          fontSize: 12,
          fontStyle: 'bold',
          precision: 2,
          textShadow: false,
          overlap: true
        }
      ]
    }
  };

  @ViewChild('mapDiv') mapDiv: ElementRef;
  @ViewChild('mapImg') mapImg: ElementRef;
  @ViewChild('chartCanvas') chartCanvas: ElementRef;
  @ViewChild('chartImg') chartImg: ElementRef;
  public mapJpg: any;
  public chartJpg: any;

  public spinner = true;

  constructor(
    private _dfs: DataFormService,
    private _route: ActivatedRoute,
    @Inject(DOCUMENT) private document: Document,
    private renderer: Renderer2
  ) { }

  ngOnInit() {
    this._route.params.subscribe(params => {
      this.id_dataset = params['id'];
      if (this.id_dataset) {
        this.getDataset(this.id_dataset);
      }
    });
    // Titre
    this.pdfTitle = AppConfig.METADATA.AF_PDF_TITLE;
    // Etiquettes
    this.logo = "Logo_pdf.png";
    this.bandeau = 'Bandeau_pdf.png';
    this.entite = 'sinp';
    // Footer
    this.footerUrl = AppConfig.URL_APPLICATION + '/#/metadata/dataset_detail/' + this.id_dataset;
    this.footerDate = new Date();
  }

  getDataset(id) {
    this._dfs.getDatasetDetails(id).subscribe(data => {
      this.dataset = data;
      console.log(this.dataset);
      if (this.dataset.modules) {
        this.dataset.modules = this.dataset.modules.map(e => e.module_code).join(', ');
      }
      if ('bbox' in data) {
        this.geojsonData = data['bbox'];
      }
    });
    this._dfs.getTaxaDistribution('group2_inpn', { id_dataset: id }).subscribe(data => {
      this.pieChartData = [];
      this.pieChartLabels = [];
      for (let row of data) {
        this.pieChartData.push(row['count']);
        this.pieChartLabels.push(row['group']);
      }
      // in order to have chart instance
      setTimeout(() => {
        this.chart.chart.update();
      }, 1000);
    });
  }

  graphToImg() {
    // Change the ChartJS chart into a picture to avoid transparency incompatibility in jsPDF
    const canvas = <HTMLCanvasElement> this.document.getElementById('canvas-repartition');
    if(canvas) {
      this.chartJpg = canvas.toDataURL('image/jpg');
      this.renderer.removeAttribute(this.chartImg.nativeElement, 'hidden');
      this.renderer.setAttribute(this.chartCanvas.nativeElement, 'hidden', 'true');
      this.renderer.setProperty(this.chartCanvas.nativeElement, 'innerHTML', '');
    }
  }

  mapToImg() {
    // Remove the navigation buttons to render a clean image
    const mapButtons = document.getElementsByClassName('leaflet-top leaflet-right')[0];
    if (mapButtons) {
      mapButtons.remove();
    }
    // Remove the search bar to render a clean image
    const mapSearchbar = document.getElementsByClassName('form-row ng-star-inserted')[0];
    if (mapSearchbar) {
      mapSearchbar.remove();
    }
    // Change the Leaflet map into a picture to avoid transparency incompatibility in jsPDF
    const divSelector = <HTMLElement> document.querySelector('#map-div');
    if (divSelector) {
      html2canvas(divSelector, { useCORS: true }).then(canvas => {
        if(canvas) {
          this.mapJpg = canvas.toDataURL('image/jpg');
          this.renderer.removeAttribute(this.mapImg.nativeElement, 'hidden');
          this.renderer.setAttribute(this.mapDiv.nativeElement, 'hidden', 'true');
          this.renderer.setProperty(this.mapDiv.nativeElement, 'innerHTML', '');
        }
      });
    }
  }

  convertGraphs() {
    // Convert the two graphs into pictures and return a Promise to ensure having the pictures before generating PDF
    const promise = new Promise((resolve, reject) => {
      this.mapToImg();
      this.graphToImg();
      setTimeout(() => {
        resolve('true');
      }, 3000);
    });
    return promise;
  }

  getPdf() {
    // We generate the PDF from the DIV element
    const pdf = new jsPDF('p', 'pt', 'a4');
    this.convertGraphs().then((value) => {
      pdf.html((document.querySelector('#pdf-content-page-1') as HTMLElement), {
        callback: doc => {
          // Redefinition of the date to display the generation date and not the page loading one
          this.pdfDate = new Date();
          this.footerDate = this.pdfDate;

          // PDF file name generated according to the variables of the dataset
          this.pdfName = this.id_dataset.toString();
          this.pdfName = this.pdfName.concat('_', this.dataset.dataset_name.substring(0, 31).replace(' ', '_'));
          if (this.pdfDate.getDate() < 10) {
            this.pdfName = this.pdfName.concat('_0', this.pdfDate.getDate().toString());
          } else {
            this.pdfName = this.pdfName.concat('_', this.pdfDate.getDate().toString());
          }
          if (this.pdfDate.getMonth() < 9) {
            this.pdfName = this.pdfName.concat('0', (this.pdfDate.getMonth() + 1).toString());
          } else {
            this.pdfName = this.pdfName.concat((this.pdfDate.getMonth() + 1).toString());
          }
          this.pdfName = this.pdfName.concat(this.pdfDate.getFullYear().toString());
          if (this.pdfDate.getHours() < 10) {
            this.pdfName = this.pdfName.concat('_0', this.pdfDate.getHours().toString());
          } else {
            this.pdfName = this.pdfName.concat('_', this.pdfDate.getHours().toString());
          }
          if (this.pdfDate.getMinutes() < 10) {
            this.pdfName = this.pdfName.concat('0', this.pdfDate.getMinutes().toString());
          } else {
            this.pdfName = this.pdfName.concat(this.pdfDate.getMinutes().toString());
          }
          if (this.pdfDate.getSeconds() < 10) {
            this.pdfName = this.pdfName.concat('0', this.pdfDate.getSeconds().toString());
          } else {
            this.pdfName = this.pdfName.concat(this.pdfDate.getSeconds().toString());
          }

          // If we have a second page in the HTML preview, we add it to the jsPDF element
          const page2 = document.querySelector('#pdf-content-page-2') as HTMLElement;
          if (page2) {
            doc.addPage('a4', 'p');
            doc.html(page2, {
              callback: doc => {
                doc.save(this.pdfName);
              },
              x: -99999,
              y: 840
            });
          } else {
            doc.save(this.pdfName);
          }
        }
      });
    });
  }
}
