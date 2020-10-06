import logging

from flask import current_app

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.sql import func

from geonature.utils.errors import GeonatureApiError

from geonature.utils.env import DB
from geonature.core.gn_meta.models import (
    TDatasets,
    CorDatasetActor,
    TAcquisitionFramework,
    CorAcquisitionFrameworkActor,
)
from geonature.core.gn_commons.models import TModules
from geonature.core.users.models import BibOrganismes

from .xml_parser import parse_acquisition_framwork_xml, parse_jdd_xml
from .mtd_webservice import get_jdd_by_user_id, get_acquisition_framework

NOMENCLATURE_MAPPING = {
    "id_nomenclature_data_type": "DATA_TYP",
    "id_nomenclature_dataset_objectif": "JDD_OBJECTIFS",
    "id_nomenclature_data_origin": "DS_PUBLIQUE",
    "id_nomenclature_source_status": "STATUT_SOURCE",
}

# get the root logger
log = logging.getLogger()
gunicorn_error_logger = logging.getLogger("gunicorn.error")


def create_cor_object_actors(actors, new_object):
    for act in actors:
        org = None
        # UUID in actually only present on JDD XML files
        # Filter on UUID is preferable if available since it avoids dupes based on name changes
        if act["uuid_organism"]:
            org = (
                DB.session.query(BibOrganismes)
                .filter(BibOrganismes.uuid_organisme == act["uuid_organism"])
                .one_or_none()
            )
        else:
            org = (
                DB.session.query(BibOrganismes)
                .filter(BibOrganismes.nom_organisme == act["organism"])
                .one_or_none()
            )
        if not org:
            org = BibOrganismes(
                **{
                    "nom_organisme": act["organism"],
                    "uuid_organisme": act["uuid_organism"],
                }
            )
            DB.session.add(org)
            DB.session.commit()

        dict_cor = {
            "id_organism": org.id_organisme,
            "id_nomenclature_actor_role": func.ref_nomenclatures.get_id_nomenclature(
                "ROLE_ACTEUR", act["actor_role"]
            ),
        }

        if isinstance(new_object, TAcquisitionFramework):
            cor_actor = CorAcquisitionFrameworkActor(**dict_cor)
            new_object.cor_af_actor.append(cor_actor)
        elif isinstance(new_object, TDatasets):
            cor_actor = CorDatasetActor(**dict_cor)
            new_object.cor_dataset_actor.append(cor_actor)


def post_acquisition_framework(uuid=None, id_user=None, id_organism=None):
    """ 
        Post an acquisition framwork from MTD XML
        Params:
            uuid (str): uuid of the acquisition framework
            id_user (int): the id of the user connected via CAS
            id_organism (int): the id of the organism user via CAS
    
    """
    xml_af = None
    xml_af = get_acquisition_framework(uuid)

    if xml_af:
        acquisition_framwork = parse_acquisition_framwork_xml(xml_af)
        actors = acquisition_framwork.pop("actors")
        new_af = TAcquisitionFramework(**acquisition_framwork)
        id_acquisition_framework = TAcquisitionFramework.get_id(uuid)
        # if the CA already exist in the DB
        if id_acquisition_framework:
            # delete cor_af_actor
            new_af.id_acquisition_framework = id_acquisition_framework

            delete_q = CorAcquisitionFrameworkActor.__table__.delete().where(
                CorAcquisitionFrameworkActor.id_acquisition_framework
                == id_acquisition_framework
            )
            DB.session.execute(delete_q)
            DB.session.commit()
            create_cor_object_actors(actors, new_af)
            DB.session.merge(new_af)

        # its a new AF
        else:
            create_cor_object_actors(actors, new_af)
            # Add the new CA
            DB.session.add(new_af)
        # try to commit
        try:
            DB.session.commit()
        # TODO catch db error ?
        except SQLAlchemyError as e:
            DB.session.flush()
            DB.session.rollback()
            error_msg = "Error posting an aquisition framework\nTrace:\n{} \n\n ".format(e)
            log.error(error_msg)

        return new_af.as_dict()

    return {"message": "Not found"}, 404


def add_dataset_module(dataset, id_module):
    if id_module is not None:
        dataset.modules.extend(
            DB.session.query(TModules)
            .filter(
                TModules.id_module == id_module
            ).all()
        )
    else:
        dataset.modules.extend(
            DB.session.query(TModules)
            .filter(
                TModules.module_code.in_(
                    current_app.config["CAS"]["JDD_MODULE_CODE_ASSOCIATION"]
                )
            ).all()
        )


def post_jdd_from_user(id_user=None, id_organism=None):
    """ Post a jdd from the mtd XML"""
    xml_jdd = None
    xml_jdd = get_jdd_by_user_id(id_user)
    dataset_list_model = []
    if xml_jdd:
        dataset_list = parse_jdd_xml(xml_jdd)
        posted_af_uuid = {}
        for ds in dataset_list:
            actors = ds.pop("actors")
            # prevent to not fetch, post or merge the same acquisition framework multiple times
            if ds["uuid_acquisition_framework"] not in posted_af_uuid:
                new_af = post_acquisition_framework(
                    uuid=ds["uuid_acquisition_framework"],
                    id_user=id_user,
                    id_organism=id_organism,
                )
                # build a cached dict like {'<uuid>': 'id_acquisition_framework}
                posted_af_uuid[ds["uuid_acquisition_framework"]] = new_af[
                    "id_acquisition_framework"
                ]
            # get the id from the uuid
            ds["id_acquisition_framework"] = posted_af_uuid.get(
                ds["uuid_acquisition_framework"]
            )

            ds.pop("uuid_acquisition_framework")
            # get the id of the dataset to check if exists
            id_dataset = TDatasets.get_id(ds["unique_dataset_id"])
            ds["id_dataset"] = id_dataset
            # search nomenclature
            for key, value in ds.items():
                if key.startswith("id_nomenclature"):
                    ds[key] = func.ref_nomenclatures.get_id_nomenclature(
                        NOMENCLATURE_MAPPING.get(key), value
                    )
            #  set validable = true
            id_module = ds.pop("id_module")
            ds["validable"] = True
            ds["active"] = True
            dataset = TDatasets(**ds)
            # if the dataset already exist
            if id_dataset:
                # delete cor_ds_actor
                dataset.id_dataset = id_dataset

                delete_q = CorDatasetActor.__table__.delete().where(
                    CorDatasetActor.id_dataset == id_dataset
                )
                DB.session.execute(delete_q)
                DB.session.commit()
                create_cor_object_actors(actors, dataset)
                add_dataset_module(dataset, id_module)
                DB.session.merge(dataset)

            # its a new DS
            else:
                create_cor_object_actors(actors, dataset)
                add_dataset_module(dataset, id_module)
                # Add the new DS
                DB.session.add(dataset)
            # try to commit
            try:
                DB.session.commit()
            # TODO catch db error ?
            except SQLAlchemyError as e:
                DB.session.flush()
                DB.session.rollback()
                error_msg = "Error posting a dataset\nTrace:\n{} \n\n ".format(e)
                log.error(error_msg)

            #return dataset.as_dict()

        return {"message": "Not found"}, 404

    return {"message": "Not found"}, 404

