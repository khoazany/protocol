const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-bignumber')());
const BigNumber = require('bignumber.js');

const Margin = artifacts.require("Margin");
const ProductionERC20Short = artifacts.require("ProductionERC20Short");
const ProductionERC20Long = artifacts.require("ProductionERC20Long");
const HeldToken = artifacts.require("TokenA");
const OwedToken = artifacts.require("TokenB");

const { ADDRESSES, BYTES32 } = require('../../../../helpers/Constants');
const {
  callIncreasePosition,
  createOpenTx,
  doOpenPosition,
  issueTokensAndSetAllowances,
  issueTokenToAccountInAmountAndApproveProxy,
} = require('../../../../helpers/MarginHelper');
const { expectThrow } = require('../../../../helpers/ExpectHelper');
const { signLoanOffering } = require('../../../../helpers/LoanHelper');

contract('ERC20Short', accounts => {
  let dydxMargin, heldToken, owedToken;

  let POSITIONS = {
    LONG: {
      TOKEN_CONTRACT: null,
      TX: null,
      ID: null,
      SELL_ORDER: null,
      NUM_TOKENS: 0,
      PRINCIPAL: 0,
      SALT: 0
    },
    SHORT: {
      TOKEN_CONTRACT: null,
      TX: null,
      ID: null,
      SELL_ORDER: null,
      NUM_TOKENS: 0,
      PRINCIPAL: 0,
      SALT: 0
    }
  };

  let pepper = 0;
  const INITIAL_TOKEN_HOLDER = accounts[9];
  const TRUSTED_LATE_CLOSER = accounts[8];

  before('Set up Proxy, Margin accounts', async () => {
    [
      dydxMargin,
      heldToken,
      owedToken
    ] = await Promise.all([
      Margin.deployed(),
      HeldToken.deployed(),
      OwedToken.deployed()
    ]);
  });

  async function setUpPositions() {
    pepper++;

    POSITIONS.LONG.SALT = 123456 + pepper;
    POSITIONS.SHORT.SALT = 654321 + pepper;

    POSITIONS.LONG.TX = await doOpenPosition(accounts.slice(1), { salt: POSITIONS.LONG.SALT });
    POSITIONS.SHORT.TX = await doOpenPosition(accounts.slice(2), { salt: POSITIONS.SHORT.SALT });

    expect(POSITIONS.LONG.TX.trader).to.be.not.eq(POSITIONS.SHORT.TX.trader);

    POSITIONS.LONG.ID = POSITIONS.LONG.TX.id;
    POSITIONS.SHORT.ID = POSITIONS.SHORT.TX.id;

    POSITIONS.LONG.PRINCIPAL = POSITIONS.LONG.TX.principal;
    POSITIONS.SHORT.PRINCIPAL = POSITIONS.SHORT.TX.principal;

    [
      POSITIONS.LONG.NUM_TOKENS,
      POSITIONS.SHORT.NUM_TOKENS
    ] = await Promise.all([
      dydxMargin.getPositionBalance.call(POSITIONS.LONG.ID),
      dydxMargin.getPositionPrincipal.call(POSITIONS.SHORT.ID)
    ]);
  }

  async function setUpTokens(multiplier) {
    POSITIONS.LONG.TRUSTED_RECIPIENTS = [ADDRESSES.TEST[1], ADDRESSES.TEST[2]];
    POSITIONS.LONG.TRUSTED_WITHDRAWERS = [ADDRESSES.TEST[3], ADDRESSES.TEST[4]];
    POSITIONS.SHORT.TRUSTED_RECIPIENTS = [ADDRESSES.TEST[3], ADDRESSES.TEST[4]];
    POSITIONS.SHORT.TRUSTED_WITHDRAWERS = [ADDRESSES.TEST[1], ADDRESSES.TEST[2]];
    [
      POSITIONS.LONG.TOKEN_CONTRACT,
      POSITIONS.SHORT.TOKEN_CONTRACT
    ] = await Promise.all([
      ProductionERC20Long.new(
        POSITIONS.LONG.ID,
        dydxMargin.address,
        INITIAL_TOKEN_HOLDER,
        POSITIONS.LONG.TRUSTED_RECIPIENTS,
        POSITIONS.LONG.TRUSTED_WITHDRAWERS,
        POSITIONS.LONG.NUM_TOKENS.times(multiplier),
        TRUSTED_LATE_CLOSER
      ),
      ProductionERC20Short.new(
        POSITIONS.SHORT.ID,
        dydxMargin.address,
        INITIAL_TOKEN_HOLDER,
        POSITIONS.SHORT.TRUSTED_RECIPIENTS,
        POSITIONS.LONG.TRUSTED_WITHDRAWERS,
        POSITIONS.SHORT.NUM_TOKENS.times(multiplier),
        TRUSTED_LATE_CLOSER
      )
    ]);
  }

  async function transferPositionsToTokens() {
    await Promise.all([
      dydxMargin.transferPosition(
        POSITIONS.LONG.ID,
        POSITIONS.LONG.TOKEN_CONTRACT.address,
        { from: POSITIONS.LONG.TX.trader }
      ),
      dydxMargin.transferPosition(
        POSITIONS.SHORT.ID,
        POSITIONS.SHORT.TOKEN_CONTRACT.address,
        { from: POSITIONS.SHORT.TX.trader }
      ),
    ]);
  }

  describe('Constructor', () => {
    const positionId = BYTES32.TEST[0];
    const tokenCap = new BigNumber('123456787654321');
    const trustedRecipient = accounts[9];
    const trustedWithdrawer = accounts[8];
    const untrustedAccount = accounts[7];

    it('sets constants correctly for short', async () => {
      const tokenContract = await ProductionERC20Short.new(
        positionId,
        dydxMargin.address,
        INITIAL_TOKEN_HOLDER,
        [trustedRecipient],
        [trustedWithdrawer],
        tokenCap,
        TRUSTED_LATE_CLOSER
      );
      const [
        supply,
        cap,
        pid,
        ith,
        tlc,
        tr_is_tr,
        tw_is_tr,
        ua_is_tr,
        tr_is_tw,
        tw_is_tw,
        ua_is_tw,
      ] = await Promise.all([
        tokenContract.totalSupply.call(),
        tokenContract.tokenCap.call(),
        tokenContract.POSITION_ID.call(),
        tokenContract.INITIAL_TOKEN_HOLDER.call(),
        tokenContract.TRUSTED_LATE_CLOSER.call(),
        tokenContract.TRUSTED_RECIPIENTS.call(trustedRecipient),
        tokenContract.TRUSTED_RECIPIENTS.call(trustedWithdrawer),
        tokenContract.TRUSTED_RECIPIENTS.call(untrustedAccount),
        tokenContract.TRUSTED_WITHDRAWERS.call(trustedRecipient),
        tokenContract.TRUSTED_WITHDRAWERS.call(trustedWithdrawer),
        tokenContract.TRUSTED_WITHDRAWERS.call(untrustedAccount),
      ]);
      expect(supply).to.be.bignumber.eq(0);
      expect(cap).to.be.bignumber.eq(tokenCap);
      expect(pid).to.be.bignumber.eq(positionId);
      expect(ith).to.be.bignumber.eq(INITIAL_TOKEN_HOLDER);
      expect(tlc).to.be.bignumber.eq(TRUSTED_LATE_CLOSER);
      expect(tr_is_tr).to.be.true;
      expect(tw_is_tr).to.be.false;
      expect(ua_is_tr).to.be.false;
      expect(tr_is_tw).to.be.false;
      expect(tw_is_tw).to.be.true;
      expect(ua_is_tw).to.be.false;
    });

    it('sets constants correctly for long', async () => {
      const tokenContract = await ProductionERC20Short.new(
        positionId,
        dydxMargin.address,
        INITIAL_TOKEN_HOLDER,
        [trustedRecipient],
        [trustedWithdrawer],
        tokenCap,
        TRUSTED_LATE_CLOSER
      );
      const [
        supply,
        cap,
        pid,
        ith,
        tlc,
        tr_is_tr,
        tw_is_tr,
        ua_is_tr,
        tr_is_tw,
        tw_is_tw,
        ua_is_tw,
      ] = await Promise.all([
        tokenContract.totalSupply.call(),
        tokenContract.tokenCap.call(),
        tokenContract.POSITION_ID.call(),
        tokenContract.INITIAL_TOKEN_HOLDER.call(),
        tokenContract.TRUSTED_LATE_CLOSER.call(),
        tokenContract.TRUSTED_RECIPIENTS.call(trustedRecipient),
        tokenContract.TRUSTED_RECIPIENTS.call(trustedWithdrawer),
        tokenContract.TRUSTED_RECIPIENTS.call(untrustedAccount),
        tokenContract.TRUSTED_WITHDRAWERS.call(trustedRecipient),
        tokenContract.TRUSTED_WITHDRAWERS.call(trustedWithdrawer),
        tokenContract.TRUSTED_WITHDRAWERS.call(untrustedAccount),
      ]);
      expect(supply).to.be.bignumber.eq(0);
      expect(cap).to.be.bignumber.eq(tokenCap);
      expect(pid).to.be.bignumber.eq(positionId);
      expect(ith).to.be.bignumber.eq(INITIAL_TOKEN_HOLDER);
      expect(tlc).to.be.bignumber.eq(TRUSTED_LATE_CLOSER);
      expect(tr_is_tr).to.be.true;
      expect(tw_is_tr).to.be.false;
      expect(ua_is_tr).to.be.false;
      expect(tr_is_tw).to.be.false;
      expect(tw_is_tw).to.be.true;
      expect(ua_is_tw).to.be.false;
    });
  });

  describe('#receivePositionOwnership', () => {
    it('succeeds for a high enough tokenCap', async () => {
      await setUpPositions();
      await setUpTokens(1);

      for (let type in POSITIONS) {
        const POSITION = POSITIONS[type];

        await dydxMargin.transferPosition(
          POSITION.ID,
          POSITION.TOKEN_CONTRACT.address,
          { from: POSITION.TX.owner }
        );

        const supply = await POSITION.TOKEN_CONTRACT.totalSupply.call();

        expect(supply).to.be.bignumber.eq(POSITION.NUM_TOKENS);
      }
    });

    it('fails for low tokenCap', async () => {
      await setUpPositions();
      await setUpTokens(.9);

      for (let type in POSITIONS) {
        const POSITION = POSITIONS[type];

        await expectThrow(
          dydxMargin.transferPosition(
            POSITION.ID,
            POSITION.TOKEN_CONTRACT.address,
            { from: POSITION.TX.owner }
          )
        );
      }
    });
  });

  describe('#setTokenCap', () => {
    it('fails for non-owner', async () => {
      const rando = accounts[6];
      const newCap = new BigNumber(1000);
      await setUpTokens(0);
      for (let type in POSITIONS) {
        const contract = POSITIONS[type].TOKEN_CONTRACT;

        await expectThrow(
          contract.setTokenCap(newCap, { from: rando })
        );
      }
    });

    it('sets the value properly for uninitialized token contract', async () => {
      const newCap1 = new BigNumber(2000);
      const newCap2 = new BigNumber(1000);
      await setUpTokens(0);
      for (let type in POSITIONS) {
        const contract = POSITIONS[type].TOKEN_CONTRACT;

        const owner = await contract.owner.call();
        const contractCap1 = await contract.tokenCap.call();
        await contract.setTokenCap(newCap1, { from: owner });
        const contractCap2 = await contract.tokenCap.call();
        await contract.setTokenCap(newCap2, { from: owner });
        const contractCap3 = await contract.tokenCap.call();

        expect(contractCap1).to.be.bignumber.eq(0);
        expect(contractCap2).to.be.bignumber.eq(newCap1);
        expect(contractCap3).to.be.bignumber.eq(newCap2);
      }
    });

    it('sets values properly for initialized token contract', async () => {
      await setUpPositions();
      await setUpTokens(1);
      await transferPositionsToTokens();

      for (let type in POSITIONS) {
        const contract = POSITIONS[type].TOKEN_CONTRACT;

        const owner = await contract.owner.call();
        const contractCap1 = await contract.tokenCap.call();
        await contract.setTokenCap(contractCap1.div(2), { from: owner });
        const contractCap2 = await contract.tokenCap.call();
        await contract.setTokenCap(contractCap1.times(2), { from: owner });
        const contractCap3 = await contract.tokenCap.call();

        expect(contractCap2).to.be.bignumber.eq(contractCap1.div(2));
        expect(contractCap3).to.be.bignumber.eq(contractCap1.times(2));
      }
    });
  });

  describe('#increasePositionOnBehalfOf', () => {
    let pepper = 0;

    async function doIncrease(position, acts, args) {
      args = args || {};
      args.throws = args.throws || false;
      args.multiplier = args.multiplier || 1;

      let incrTx = await createOpenTx(acts, { salt: 99999 + pepper });
      incrTx.loanOffering.rates.minHeldToken = new BigNumber(0);
      incrTx.loanOffering.signature = await signLoanOffering(incrTx.loanOffering);
      incrTx.owner = position.TOKEN_CONTRACT.address;
      await issueTokensAndSetAllowances(incrTx);
      incrTx.id = position.TX.id;
      incrTx.principal = position.PRINCIPAL.times(args.multiplier);
      await issueTokenToAccountInAmountAndApproveProxy(
        heldToken,
        incrTx.trader,
        incrTx.depositAmount.times(4)
      );

      if (args.throws) {
        await expectThrow(callIncreasePosition(dydxMargin, incrTx));
      } else {
        await callIncreasePosition(dydxMargin, incrTx);
      }
      return incrTx;
    }

    beforeEach('Set up all tokenized positions', async () => {
      await setUpPositions();
      await setUpTokens(2);
      await transferPositionsToTokens();
    });

    it('succeeds if the number of tokens remains under the token cap', async () => {
      let tempAccounts = accounts;
      for (let type in POSITIONS) {
        const POSITION = POSITIONS[type];
        tempAccounts = tempAccounts.slice(1);
        await doIncrease(POSITION, tempAccounts, { throws: false, multiplier: 1 });

        const [
          supply,
          cap
        ] = await Promise.all([
          POSITION.TOKEN_CONTRACT.totalSupply.call(),
          POSITION.TOKEN_CONTRACT.tokenCap.call(),
        ]);
        expect(supply).to.be.bignumber.eq(cap);
      }
    });

    it('fails if it would exceed the token cap', async () => {
      let tempAccounts = accounts;
      for (let type in POSITIONS) {
        const POSITION = POSITIONS[type];
        tempAccounts = tempAccounts.slice(1);
        await doIncrease(POSITION, tempAccounts, { throws: true, multiplier: 1.1 });
      }
    });

    it('succeeds after increase', async () => {
      let tempAccounts = accounts;
      for (let type in POSITIONS) {
        const POSITION = POSITIONS[type];
        tempAccounts = tempAccounts.slice(1);

        // increase fails
        await doIncrease(POSITION, tempAccounts, { throws: true, multiplier: 1.5 });

        // setTokenCap for higher amount
        const tokenContract = POSITION.TOKEN_CONTRACT;
        const owner = await tokenContract.owner.call();
        await tokenContract.setTokenCap(POSITION.NUM_TOKENS.times(4), { from: owner });

        // increase succeeds
        await doIncrease(POSITION, tempAccounts, { throws: false, multiplier: 1.5 });
      }
    });
  });

  describe('#closePositionOnBehalfOf', () => {
    it('succeeds even when remaining amount is above tokenCap', async () => {
      let tempAccounts = accounts;

      await setUpPositions();
      await setUpTokens(1);
      await transferPositionsToTokens();

      for (let type in POSITIONS) {
        const POSITION = POSITIONS[type];
        tempAccounts = tempAccounts.slice(1);

        const tokenContract = POSITION.TOKEN_CONTRACT;
        const owner = await tokenContract.owner.call();
        await tokenContract.setTokenCap(POSITION.NUM_TOKENS.div(2), { from: owner });

        await issueTokenToAccountInAmountAndApproveProxy(
          owedToken,
          INITIAL_TOKEN_HOLDER,
          POSITION.TX.loanOffering.rates.maxAmount
        );
        await dydxMargin.closePositionDirectly(
          POSITION.ID,
          POSITION.NUM_TOKENS.div(10),
          INITIAL_TOKEN_HOLDER,
          { from: INITIAL_TOKEN_HOLDER }
        );

        const [
          supply,
          cap
        ] = await Promise.all([
          POSITION.TOKEN_CONTRACT.totalSupply.call(),
          POSITION.TOKEN_CONTRACT.tokenCap.call(),
        ]);
        expect(supply).to.be.bignumber.gt(cap);
      }
    });
  });
});
