///<reference path="../../node_modules/@types/jest/index.d.ts"/>
// tslint:disable:max-line-length
import {rpc, api, ApiOptions} from './lib/api';
import { Logger as LoggerType } from '../../src/core/Logger';
import { BlackBoxTestUtil } from './lib/BlackBoxTestUtil';
import { Commands } from '../../src/api/commands/CommandEnumType';
import { CreatableModel } from '../../src/api/enums/CreatableModel';
import { GenerateListingItemTemplateParams } from '../../src/api/requests/params/GenerateListingItemTemplateParams';
import * as listingItemTemplateCreateRequestWithoutLocationMarker from '../testdata/createrequest/listingItemTemplateCreateRequestWithoutLocationMarker.json';
import * as resources from 'resources';
// tslint:enable:max-line-length

describe('ListingItemSearchCommand', () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = process.env.JASMINE_TIMEOUT;

    const log: LoggerType = new LoggerType(__filename);


    const node1 = async ( method: string, params: any[] = []): Promise<any> => {
        return rpc(method, params, 0);
    };

    const node2 = async (method: string, params: any[] = []): Promise<any> => {
        return rpc(method, params, 1);
    };

    const testUtil = new BlackBoxTestUtil();
    const templateCommand = Commands.TEMPLATE_ROOT.commandName;
    const templatePostCommand = Commands.TEMPLATE_POST.commandName;

    let defaultProfile;
    let defaultMarket;
    let listingItemTemplates: resources.ListingItemTemplate[];
    let postedTemplateId;

    beforeAll(async () => {
        await testUtil.cleanDb();

        const generateListingItemTemplateParams = new GenerateListingItemTemplateParams([
            true,   // generateItemInformation
            true,   // generateShippingDestinations
            false,   // generateItemImages
            true,   // generatePaymentInformation
            true,   // generateEscrow
            true,   // generateItemPrice
            true,   // generateMessagingInformation
            true    // generateListingItemObjects
        ]).toParamsArray();

        // get default profile
        defaultProfile = await testUtil.getDefaultProfile();

        // fetch default market
        defaultMarket = await testUtil.getDefaultMarket();

        // generate listingItemTemplate
        listingItemTemplates = await testUtil.generateData(
            CreatableModel.LISTINGITEMTEMPLATE, // what to generate
            1,                          // how many to generate
            true,                       // return model
            generateListingItemTemplateParams   // what kind of data to generate
        ) as resources.ListingItemTemplates[];

    });

    test('Should post a ListingItem in to the default marketplace', async () => {
        postedTemplateId = listingItemTemplates[0].id;
        const res: any = await rpc(templateCommand, [templatePostCommand, postedTemplateId, defaultMarket.id]);
        res.expectJson();
        res.expectStatusCode(200);

        const result: any = res.getBody()['result'];
        expect(result.result).toBe('Sent.');
        expect(result.txid).toBeDefined();
        expect(result.fee).toBeGreaterThan(0);
    });

    test('Should post a ListingItem in to the default marketplace without LocationMarker', async () => {

        // generate listingItemTemplate
        listingItemTemplates = await testUtil.addData(
            CreatableModel.LISTINGITEMTEMPLATE,
            listingItemTemplateCreateRequestWithoutLocationMarker
        ) as resources.ListingItemTemplates[];

        postedTemplateId = listingItemTemplates[0].id;
        const res: any = await rpc(templateCommand, [templatePostCommand, postedTemplateId, defaultMarket.id]);
        res.expectJson();
        res.expectStatusCode(200);

        const result: any = res.getBody()['result'];
        expect(result.result).toBe('Sent.');
        expect(result.txid).toBeDefined();
        expect(result.fee).toBeGreaterThan(0);
    });



});
