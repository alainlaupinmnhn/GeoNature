import {Component, ElementRef, Inject, OnInit, ViewChild, AfterViewInit, Renderer2, AfterContentInit} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DataFormService } from '@geonature_common/form/data-form.service';
import { BaseChartDirective } from 'ng2-charts';
import { AppConfig } from '@geonature_config/app.config';
import htmlToPdfmake from 'html-to-pdfmake';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
pdfMake.vfs = pdfFonts.pdfMake.vfs;
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { DOCUMENT } from '@angular/common';

@Component({
  selector: 'pnx-af-export',
  templateUrl: './af-export.component.html',
  styleUrls: ['./af-card.component.scss', './metadata_pdf.css']
})
export class AfExportComponent implements OnInit, AfterViewInit, AfterContentInit {
  public id_af: number;
  public af: any;
  public acquisitionFrameworks: any;
  public is_certificate: boolean;
  //Titre
  public pdfClosedTitle: string;
  public pdfTitle: string;
  // Etiquettes
  public logo: string;
  public bandeau: string;
  public entite: string;
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
    cutoutPercentage: 80,
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
          render: 'label',
          arc: true,
          fontSize: 14,
          position: 'outside',
          overlap: false
        },
        {
          render: 'percentage',
          fontColor: 'white',
          fontSize: 14,
          fontStyle: 'bold',
          precision: 2,
          textShadow: true,
          overlap: false
        }
      ]
    }
  };

  @ViewChild('repartitionCanvas') repartitionCanvas: ElementRef;
  public repartitionImg: any;

  public spinner = true;

  constructor(private _dfs: DataFormService, private _route: ActivatedRoute, @Inject(DOCUMENT) private document: Document, private renderer: Renderer2) {}
  ngOnInit() {
    this._route.params.subscribe(params => {
      this.id_af = params['id'];
      if (this.id_af) {
        this.getAf(this.id_af);
      }
    });
    this.is_certificate = false;
    this._route.queryParams.subscribe(params => {
      if (params['certificate'] === 'true') {
        this.is_certificate = true;
      }
    });
    // Titre
    this.pdfClosedTitle = AppConfig.METADATA.CLOSED_AF_TITLE;
    this.pdfTitle = AppConfig.METADATA.AF_PDF_TITLE;
    // Etiquettes
    this.logo = "Logo_pdf.png";
    this.bandeau = "Bandeau_pdf.png";
    this.entite = "sinp";

  }

  ngAfterViewInit() {
    //console.log(this.repartitionCanvas.nativeElement);
    //var canvas = this.repartitionCanvas.nativeElement.querySelector('#canvas-repartition');
    //var canvas = <HTMLCanvasElement> this.document.getElementById("canvas-repartition");
    //console.log(canvas);
    //this.repartitionImg = canvas.toDataURL('image/jpeg');
    //console.log(this.repartitionImg);
    //var canvas = <HTMLCanvasElement> this.document.querySelector("#canvas-repartition");
    //this.repartitionImg = canvas.toDataURL('image/jpg');
    //this.renderer.setProperty(this.repartitionCanvas.nativeElement, 'innerHTML', '');
    //this.renderer.setProperty(this.repartitionCanvas.nativeElement, 'innerHTML', '<img [src]="repartitionImg"/>');
    //this.renderer.removeAttribute(this.repartitionCanvas.nativeElement, 'hidden');
  }

  ngAfterContentInit() {
    //console.log(this.repartitionCanvas.nativeElement);
    var canvas = this.repartitionCanvas.nativeElement.querySelector('#canvas-repartition');
    //var canvas = <HTMLCanvasElement> this.document.getElementById("canvas-repartition");
    console.log(canvas);
    this.repartitionImg = canvas.toDataURL('image/jpeg');
    console.log(this.repartitionImg);
    //var canvas = <HTMLCanvasElement> this.document.querySelector("#canvas-repartition");
    //this.repartitionImg = canvas.toDataURL('image/jpg');
    //this.renderer.setProperty(this.repartitionCanvas.nativeElement, 'innerHTML', '');
    this.renderer.setProperty(this.repartitionCanvas.nativeElement, 'innerHTML', '<img [src]="repartitionImg"/>');
    this.renderer.removeAttribute(this.repartitionCanvas.nativeElement, 'hidden');
  }

  getAf(id_af: number) {
    this._dfs.getAcquisitionFrameworkDetails(id_af).subscribe(data => {
      this.af = data;
      if (this.af.acquisition_framework_start_date) {
        var start_date = new Date(this.af.acquisition_framework_start_date);
        this.af.acquisition_framework_start_date = start_date.toLocaleDateString();
      }
      if (this.af.acquisition_framework_end_date) {
        var end_date = new Date(this.af.acquisition_framework_end_date);
        this.af.acquisition_framework_end_date = end_date.toLocaleDateString();
      }
      if (this.af.datasets) {
        this._dfs
          .getTaxaDistribution('group2_inpn', { id_af: this.af.id_acquisition_framework })
          .subscribe(data2 => {
            this.pieChartData.length = 0;
            this.pieChartLabels.length = 0;
            this.pieChartData = [];
            this.pieChartLabels = [];
            for (let row of data2) {
              this.pieChartData.push(row['count']);
              this.pieChartLabels.push(row['group']);
            }
            this.spinner = false;
            setTimeout(() => {
              this.chart.chart.update();
            }, 1000);
          });
      }
    });
  }

  getPdf() {
    //const htmlIntro = htmlToPdfmake([this.pdfContent.nativeElement.innerHTML]);
    //const def = {
    //  content: htmlIntro
    //};
    //console.log(def);
    //console.log(this.pdfContent);
    //pdfMake.createPdf(def).open();

    //console.log(typeof(this.document.body));
//
    //html2canvas(this.document.querySelector("#pdfContent")).then(canvas => {
    //  console.log(canvas);
    //  return canvas;
    //});

    //console.log(this.repartitionCanvas.nativeElement);
    //var canvas = this.repartitionCanvas.nativeElement.querySelector('#canvas-repartition');
    //this.renderer.removeAttribute(this.repartitionCanvas.nativeElement, 'hidden');
    //var canvas = <HTMLCanvasElement> this.document.querySelector("#canvas-repartition");
    //if(canvas) {
    //  console.log(canvas);
    //  this.repartitionImg = canvas.toDataURL('image/jpg');
    //}
//
    //console.log(this.repartitionImg);
    //this.renderer.setProperty(this.repartitionCanvas.nativeElement, 'innerHTML', '');


    var pdf = new jsPDF('p','pt','a4', true);

    pdf.html((document.querySelector('#pdfContent') as HTMLElement), {
      callback: doc => {
        doc.save();
      },
      x: 0,
      y: 0
    });
  }

}
