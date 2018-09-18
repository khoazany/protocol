/*

    Copyright 2018 dYdX Trading Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

pragma solidity 0.4.24;
pragma experimental "v0.5.0";

import { DutchAuctionCloser } from "./DutchAuctionCloser.sol";
import { MathHelpers } from "../../../lib/MathHelpers.sol";


/**
 * @title ProductionDutchAuctionCloser
 * @author dYdX
 *
 *
 * Dutch Auction Closer contract modified for production
 */
contract ProductionDutchAuctionCloser is DutchAuctionCloser {
    // ============ Constructor ============

    constructor(
        address margin,
        uint256 callTimeLimitNumerator,
        uint256 callTimeLimitDenominator
    )
        public
        DutchAuctionCloser(
            margin,
            callTimeLimitNumerator,
            callTimeLimitDenominator
        )
    {
    }

    // ============ Public Constant Functions ============

    /**
     * Gets the cost (in heldToken) of closing part of a position such that totalHeldToken
     * heldTokens are freed from the position. This amount decreases linearly over the course of the
     * auction from totalHeldToken to zero.
     *
     * @param  positionId      Unique ID of the position
     * @param  totalHeldToken  The amount of heldTokens that are freed when closing the position
     * @return                 The amount of heldTokens that would need to be paid to the position
     *                         owner when freeing totalHeldToken tokens from the position
     */
    function getAuctionCost(
        bytes32 positionId,
        uint256 totalHeldToken
    )
        public
        view
        returns (uint256)
    {
        (
            uint256 auctionStartTimestamp,
            uint256 auctionEndTimestamp
        ) = getAuctionTimeLimits(positionId);

        require(
            block.timestamp >= auctionStartTimestamp,
            "ProductionDutchAuctionCloser#getAuctionTimeLimits: Auction has not started"
        );

        // return zero cost after the auction is over
        if (block.timestamp > auctionEndTimestamp) {
            return 0;
        }

        // linearly decreases from maximum amount to zero over the course of the auction
        return MathHelpers.getPartialAmount(
            auctionEndTimestamp.sub(block.timestamp),
            auctionEndTimestamp.sub(auctionStartTimestamp),
            totalHeldToken
        );
    }
}
