import * as Bookshelf from 'bookshelf';
import { inject, named } from 'inversify';
import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets } from '../../constants';
import { validate, request } from '../../core/api/Validate';
import { NotFoundException } from '../exceptions/NotFoundException';
import { MessageException } from '../exceptions/MessageException';
import { EscrowRepository } from '../repositories/EscrowRepository';
import { Escrow } from '../models/Escrow';
import { EscrowCreateRequest } from '../requests/EscrowCreateRequest';
import { EscrowUpdateRequest } from '../requests/EscrowUpdateRequest';
import { RpcRequest } from '../requests/RpcRequest';
import { ListingItemTemplateRepository } from '../repositories/ListingItemTemplateRepository';
import { PaymentInformationRepository } from '../repositories/PaymentInformationRepository';
import { EscrowRatioService } from '../services/EscrowRatioService';
import { AddressService } from '../services/AddressService';
import { MessageBroadcastService } from '../services/MessageBroadcastService';
import { EscrowLockFactory } from '../factories/EscrowLockFactory';
import { EscrowRefundFactory } from '../factories/EscrowRefundFactory';
import { EscrowReleaseFactory } from '../factories/EscrowReleaseFactory';

export class EscrowService {

    public log: LoggerType;

    constructor(
        @inject(Types.Service) @named(Targets.Service.EscrowRatioService) private escrowratioService: EscrowRatioService,
        @inject(Types.Repository) @named(Targets.Repository.EscrowRepository) public escrowRepo: EscrowRepository,
        @inject(Types.Repository) @named(Targets.Repository.ListingItemTemplateRepository) public listingItemTemplateRepo: ListingItemTemplateRepository,
        @inject(Types.Repository) @named(Targets.Repository.PaymentInformationRepository) private paymentInfoRepo: PaymentInformationRepository,
        @inject(Types.Service) @named(Targets.Service.AddressService) private addressService: AddressService,
        @inject(Types.Factory) @named(Targets.Factory.EscrowLockFactory) private escrowLockFactory: EscrowLockFactory,
        @inject(Types.Factory) @named(Targets.Factory.EscrowRefundFactory) private escrowRefundFactory: EscrowRefundFactory,
        @inject(Types.Factory) @named(Targets.Factory.EscrowReleaseFactory) private escrowReleaseFactory: EscrowReleaseFactory,
        @inject(Types.Service) @named(Targets.Service.MessageBroadcastService) private messageBroadcastService: MessageBroadcastService,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
    }

    public async findAll(): Promise<Bookshelf.Collection<Escrow>> {
        return this.escrowRepo.findAll();
    }

    public async findOne(id: number, withRelated: boolean = true): Promise<Escrow> {
        const escrow = await this.escrowRepo.findOne(id, withRelated);
        if (escrow === null) {
            this.log.warn(`Escrow with the id=${id} was not found!`);
            throw new NotFoundException(id);
        }
        return escrow;
    }

    public async findOneByPaymentInformation(id: number, withRelated: boolean = true): Promise<Escrow> {
        const escrow = await this.escrowRepo.findOneByPaymentInformation(id, withRelated);
        if (escrow === null) {
            this.log.warn(`Escrow with the id=${id} was not found!`);
            throw new NotFoundException(id);
        }
        return escrow;
    }

    public async createCheckByListingItem(body: any): Promise<Escrow> {
        // check listingItem by listingItemTemplateId
        const listingItemTemplateId = body.listingItemTemplateId;
        const listingItemTemplate = await this.listingItemTemplateRepo.findOne(listingItemTemplateId);
        if (listingItemTemplate.ListingItem.length === 0) {
            // creates an Escrow related to PaymentInformation related to ListingItemTemplate
            const paymentInformation = await this.paymentInfoRepo.findOneByListingItemTemplateId(listingItemTemplateId);
            if (paymentInformation === null) {
                this.log.warn(`PaymentInformation with the listing_item_template_id=${listingItemTemplateId} was not found!`);
                throw new MessageException(`PaymentInformation with the listing_item_template_id=${listingItemTemplateId} was not found!`);
            }
            body.payment_information_id = paymentInformation.Id;
        } else {
            this.log.warn(`Escrow cannot be created becuase Listing
            Item has allready been posted with listing-item-template-id ${listingItemTemplateId}`);
            throw new MessageException(`Escrow cannot be created becuase Listing
            Item has allready been posted with listing-item-template-id ${listingItemTemplateId}`);
        }
        delete body.listingItemTemplateId;
        return this.create(body);
    }

    @validate()
    public async create( @request(EscrowCreateRequest) data: any): Promise<Escrow> {

        const body = JSON.parse(JSON.stringify(data));

        const escrowRatio = body.ratio;
        delete body.ratio;

        // If the request body was valid we will create the escrow
        const escrow = await this.escrowRepo.create(body);

        // then create escromemowratio
        escrowRatio.escrow_id = escrow.Id;
        await this.escrowratioService.create(escrowRatio);

        // finally find and return the created escrow
        const newEscrow = await this.findOne(escrow.Id);
        return newEscrow;
    }

    public async updateCheckByListingItem(body: any): Promise<Escrow> {
        // check listingItem by listingItemTemplateId
        const listingItemTemplateId = body.listingItemTemplateId;
        const listingItemTemplate = await this.listingItemTemplateRepo.findOne(listingItemTemplateId);
        let escrowId;
        if (listingItemTemplate.ListingItem.length === 0) {
            // creates an Escrow related to PaymentInformation related to ListingItemTemplate
            const paymentInformation = await this.paymentInfoRepo.findOneByListingItemTemplateId(listingItemTemplateId);
            if (paymentInformation === null) {
                this.log.warn(`PaymentInformation with the listing_item_template_id=${listingItemTemplateId} was not found!`);
                throw new MessageException(`PaymentInformation with the listing_item_template_id=${listingItemTemplateId} was not found!`);
            }
            const escrow = await this.findOneByPaymentInformation(paymentInformation.Id, false);
            escrowId = escrow.Id;
            body.payment_information_id = paymentInformation.Id;
        } else {
            this.log.warn(`Escrow cannot be updated becuase Listing
            Item has allready been posted with listing-item-template-id ${listingItemTemplateId}`);
            throw new MessageException(`Escrow cannot be updated becuase Listing
            Item has allready been posted with listing-item-template-id ${listingItemTemplateId}`);
        }
        delete body.listingItemTemplateId;
        return this.update(escrowId, body);
    }

    @validate()
    public async update(id: number, @request(EscrowUpdateRequest) data: any): Promise<Escrow> {

        const body = JSON.parse(JSON.stringify(data));

        // find the existing one without related
        const escrow = await this.findOne(id, false);

        // set new values
        escrow.Type = body.type;

        // update escrow record
        const updatedEscrow = await this.escrowRepo.update(id, escrow.toJSON());

        // find related escrowratio
        let relatedRatio = updatedEscrow.related('Ratio').toJSON();

        // delete it
        await this.escrowratioService.destroy(relatedRatio.id);

        // and create new related data
        relatedRatio = body.ratio;
        relatedRatio.escrow_id = id;
        await this.escrowratioService.create(relatedRatio);

        // finally find and return the updated escrow
        const newEscrow = await this.findOne(id);
        return newEscrow;
    }

    public async destroyCheckByListingItem(listingItemTemplateId: any): Promise<void> {
        // check listingItem by listingItemTemplateId
        const listingItemTemplate = await this.listingItemTemplateRepo.findOne(listingItemTemplateId);
        let escrowId;
        if (listingItemTemplate.ListingItem.length === 0) {
            // creates an Escrow related to PaymentInformation related to ListingItemTemplate
            const paymentInformation = await this.paymentInfoRepo.findOneByListingItemTemplateId(listingItemTemplateId);
            if (paymentInformation === null) {
                this.log.warn(`PaymentInformation with the listing_item_template_id=${listingItemTemplateId} was not found!`);
                throw new MessageException(`PaymentInformation with the listing_item_template_id=${listingItemTemplateId} was not found!`);
            }
            const escrow = await this.findOneByPaymentInformation(paymentInformation.Id, false);
            escrowId = escrow.Id;
        } else {
            this.log.warn(`Escrow cannot be updated becuase Listing
            Item has allready been posted with listing-item-template-id ${listingItemTemplateId}`);
            throw new MessageException(`Escrow cannot be updated becuase Listing
            Item has allready been posted with listing-item-template-id ${listingItemTemplateId}`);
        }
        return this.destroy(escrowId);
    }

    public async destroy(id: number): Promise<void> {
        await this.escrowRepo.destroy(id);
    }

    @validate()
    public async lock(data: any): Promise<void> {
        // fetch the escrow
        const escrow = await this.findOne(data.escrowId, false);
        // fetch the address
        const address = await this.addressService.findOne(data.addressId, false);
        // escrowfactory to generate the lockmessage
        const messageInput = {
            escrow,
            address,
            listing: data.itemHash,
            nonce: data.nonce,
            memo: data.memo
        };
        const escrowActionMessage = await this.escrowLockFactory.get(messageInput);
        return await this.messageBroadcastService.broadcast();
    }

    @validate()
    public async refund(data: any): Promise<void> {
        // fetch the escrow
        const escrow = await this.findOne(data.escrowId, false);
        // escrowfactory to generate the lockmessage
        const messageInput = {
            escrow,
            listing: data.itemHash,
            accepted: data.accepted,
            memo: data.memo
        };
        const escrowActionMessage = await this.escrowRefundFactory.get(messageInput);
        return await this.messageBroadcastService.broadcast();
    }

    @validate()
    public async release(data: any): Promise<void> {
        // fetch the escrow
        const escrow = await this.findOne(data.escrowId, false);
        // escrowfactory to generate the lockmessage
        const messageInput = {
            escrow,
            listing: data.itemHash,
            memo: data.memo
        };
        const escrowActionMessage = await this.escrowReleaseFactory.get(messageInput);
        return await this.messageBroadcastService.broadcast();
    }

    // TODO: REMOVE
    @validate()
    public async rpcFindAll( @request(RpcRequest) data: any): Promise<Bookshelf.Collection<Escrow>> {
        return this.findAll();
    }

    @validate()
    public async rpcFindOne( @request(RpcRequest) data: any): Promise<Escrow> {
        return this.findOne(data.params[0]);
    }

    @validate()
    public async rpcCreate( @request(RpcRequest) data: any): Promise<Escrow> {
        return this.create({
            type: data.params[0],
            ratio: {
                buyer: data.params[1],
                seller: data.params[2]
            }
        });
    }

    @validate()
    public async rpcUpdate( @request(RpcRequest) data: any): Promise<Escrow> {
        return this.update(data.params[0], {
            type: data.params[1],
            ratio: {
                buyer: data.params[2],
                seller: data.params[3]
            }
        });
    }

    @validate()
    public async rpcDestroy( @request(RpcRequest) data: any): Promise<void> {
        return this.destroy(data.params[0]);
    }

}
