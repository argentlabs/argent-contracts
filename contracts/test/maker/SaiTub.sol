/// tub.sol -- simplified CDP engine (baby brother of `vat')

// Copyright (C) 2017  Nikolai Mushegian <nikolai@dapphub.com>
// Copyright (C) 2017  Daniel Brockman <daniel@dapphub.com>
// Copyright (C) 2017  Rain Break <rainbreak@riseup.net>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.5.4;

import "./DS/DSThing.sol";
import "./DS/DSToken.sol";
import "./DS/DSValue.sol";
import "../../exchange/ERC20.sol";

import "./SaiVox.sol";

contract SaiTubEvents {
    event LogNewCup(address indexed lad, bytes32 cup);
}

contract SaiTub is DSThing, SaiTubEvents {
    DSToken  public  sai;  // Stablecoin
    DSToken  public  sin;  // Debt (negative sai)

    DSToken  public  skr;  // Abstracted collateral
    ERC20    public  gem;  // Underlying collateral

    DSToken  public  gov;  // Governance token

    SaiVox   public  vox;  // Target price feed
    DSValue  public  pip;  // Reference price feed
    DSValue  public  pep;  // Governance price feed

    address  public  tap;  // Liquidator
    address  public  pit;  // Governance Vault

    uint256  public  axe;  // Liquidation penalty
    uint256  public  cap;  // Debt ceiling
    uint256  public  mat;  // Liquidation ratio
    uint256  public  tax;  // Stability fee
    uint256  public  fee;  // Governance fee
    uint256  public  gap;  // Join-Exit Spread

    bool     public  off;  // Cage flag
    bool     public  out;  // Post cage exit

    uint256  public  fit;  // REF per SKR (just before settlement)

    uint256  public  rho;  // Time of last drip
    uint256         _chi;  // Accumulated Tax Rates
    uint256         _rhi;  // Accumulated Tax + Fee Rates
    uint256  public  rum;  // Total normalised debt

    uint256                   public  cupi;
    mapping (bytes32 => Cup)  public  cups;

    struct Cup {
        address  lad;      // CDP owner
        uint256  ink;      // Locked collateral (in SKR)
        uint256  art;      // Outstanding normalised debt (tax only)
        uint256  ire;      // Outstanding normalised debt
    }

    function lad(bytes32 cup) public view returns (address) {
        return cups[cup].lad;
    }
    function ink(bytes32 cup) public view returns (uint) {
        return cups[cup].ink;
    }
    function tab(bytes32 cup) public returns (uint) {
        return rmul(cups[cup].art, chi());
    }
    function rap(bytes32 cup) public returns (uint) {
        return sub(rmul(cups[cup].ire, rhi()), tab(cup));
    }

    // Total CDP Debt
    function din() public returns (uint) {
        return rmul(rum, chi());
    }
    // Backing collateral
    function air() public view returns (uint) {
        return skr.balanceOf(address(this));
    }
    // Raw collateral
    function pie() public view returns (uint) {
        return gem.balanceOf(address(this));
    }

    //------------------------------------------------------------------

    constructor(
        DSToken  sai_,
        DSToken  sin_,
        DSToken  skr_,
        ERC20    gem_,
        DSToken  gov_,
        DSValue  pip_,
        DSValue  pep_,
        SaiVox   vox_,
        address  pit_
    ) public {
        gem = gem_;
        skr = skr_;

        sai = sai_;
        sin = sin_;

        gov = gov_;
        pit = pit_;

        pip = pip_;
        pep = pep_;
        vox = vox_;

        axe = RAY;
        mat = RAY;
        tax = RAY;
        fee = RAY;
        gap = WAD;

        _chi = RAY;
        _rhi = RAY;

        rho = era();
    }

    function era() public view returns (uint) {
        return block.timestamp;
    }

    //--Risk-parameter-config-------------------------------------------

    function mold(bytes32 param, uint val) public payable note auth {
        if      (param == 'cap') cap = val;
        else if (param == 'mat') { require(val >= RAY); mat = val; }
        else if (param == 'tax') { require(val >= RAY); drip(); tax = val; }
        else if (param == 'fee') { require(val >= RAY); drip(); fee = val; }
        else if (param == 'axe') { require(val >= RAY); axe = val; }
        else if (param == 'gap') { require(val >= WAD); gap = val; }
        else return;
    }

    //--Price-feed-setters----------------------------------------------

    function setPip(DSValue pip_) public payable note auth {
        pip = pip_;
    }
    function setPep(DSValue pep_) public payable note auth {
        pep = pep_;
    }
    function setVox(SaiVox vox_) public payable note auth {
        vox = vox_;
    }

    //--Tap-setter------------------------------------------------------
    function turn(address tap_) public payable note {
        require(tap  == address(0));
        require(tap_ != address(0));
        tap = tap_;
    }

    //--Collateral-wrapper----------------------------------------------

    // Wrapper ratio (gem per skr)
    function per() public view returns (uint ray) {
        return skr.totalSupply() == 0 ? RAY : rdiv(pie(), skr.totalSupply());
    }
    // Join price (gem per skr)
    function ask(uint wad) public view returns (uint) {
        return rmul(wad, wmul(per(), gap));
    }
    // Exit price (gem per skr)
    function bid(uint wad) public view returns (uint) {
        return rmul(wad, wmul(per(), sub(2 * WAD, gap)));
    }
    function join(uint wad) public payable note {
        require(!off);
        require(ask(wad) > 0);
        require(gem.transferFrom(msg.sender, address(this), ask(wad)));
        skr.mint(msg.sender, wad);
    }
    function exit(uint wad) public payable note {
        require(!off || out);
        require(gem.transfer(msg.sender, bid(wad)));
        skr.burn(msg.sender, wad);
    }

    //--Stability-fee-accumulation--------------------------------------

    // Accumulated Rates
    function chi() public returns (uint) {
        drip();
        return _chi;
    }
    function rhi() public returns (uint) {
        drip();
        return _rhi;
    }
    function drip() public payable note {
        if (off) return;

        uint256 rho_ = era();
        uint256 age = rho_ - rho;
        if (age == 0) return;    // optimised
        rho = rho_;

        uint256 inc = RAY;

        if (tax != RAY) {  // optimised
            uint256 _chi_ = _chi;
            inc = rpow(tax, age);
            _chi = rmul(_chi, inc);
            sai.mint(tap, rmul(sub(_chi, _chi_), rum));
        }

        // optimised
        if (fee != RAY) inc = rmul(inc, rpow(fee, age));
        if (inc != RAY) _rhi = rmul(_rhi, inc);
    }


    //--CDP-risk-indicator----------------------------------------------

    // Abstracted collateral price (ref per skr)
    function tag() public view returns (uint wad) {
        return off ? fit : wmul(per(), uint(pip.read())); // (ETH/PETH) * (USD/ETH) = USD/PETH
    }
    // Returns true if cup is well-collateralized
    function safe(bytes32 cup) public returns (bool) {
        uint256 pro = rmul(tag(), ink(cup));
        uint256 con = rmul(vox.par(), tab(cup));
        uint256 min = rmul(con, mat);
        return pro >= min;
    }


    //--CDP-operations--------------------------------------------------

    function open() public payable note returns (bytes32 cup) {
        require(!off);
        cupi = add(cupi, 1);
        cup = bytes32(cupi);
        cups[cup].lad = msg.sender;
        emit LogNewCup(msg.sender, cup);
    }
    function give(bytes32 cup, address guy) public payable note {
        require(msg.sender == cups[cup].lad);
        require(guy != address(0));
        cups[cup].lad = guy;
    }

    function lock(bytes32 cup, uint wad) public payable note {
        require(!off);
        cups[cup].ink = add(cups[cup].ink, wad);
        skr.pull(msg.sender, wad);
        require(cups[cup].ink == 0 || cups[cup].ink > 0.005 ether);
    }
    function free(bytes32 cup, uint wad) public payable note {
        require(msg.sender == cups[cup].lad);
        cups[cup].ink = sub(cups[cup].ink, wad);
        skr.push(msg.sender, wad);
        require(safe(cup));
        require(cups[cup].ink == 0 || cups[cup].ink > 0.005 ether);
    }

    function draw(bytes32 cup, uint wad) public payable note {
        require(!off);
        require(msg.sender == cups[cup].lad);
        require(rdiv(wad, chi()) > 0);
        cups[cup].art = add(cups[cup].art, rdiv(wad, chi()));
        rum = add(rum, rdiv(wad, chi()));

        cups[cup].ire = add(cups[cup].ire, rdiv(wad, rhi()));
        sai.mint(cups[cup].lad, wad);

        require(safe(cup));
        require(sai.totalSupply() <= cap);
    }
    function wipe(bytes32 cup, uint wad) public payable note {
        require(!off);

        uint256 owe = rmul(wad, rdiv(rap(cup), tab(cup)));
        
        cups[cup].art = sub(cups[cup].art, rdiv(wad, chi()));
        rum = sub(rum, rdiv(wad, chi()));

        cups[cup].ire = sub(cups[cup].ire, rdiv(add(wad, owe), rhi()));
        sai.burn(msg.sender, wad);

        (bytes32 val, bool ok) = pep.peek();
        if (ok && val != 0) gov.move(msg.sender, pit, wdiv(owe, uint(val)));
    }

    function shut(bytes32 cup) public payable note {
        require(!off);
        require(msg.sender == cups[cup].lad);
        if (tab(cup) != 0) wipe(cup, tab(cup));
        if (ink(cup) != 0) free(cup, ink(cup));
        delete cups[cup];
    }

    function bite(bytes32 cup) public payable note {
        require(!safe(cup) || off);

        // Take on all of the debt, except unpaid fees
        uint256 rue = tab(cup);
        sin.mint(tap, rue);
        rum = sub(rum, cups[cup].art);
        cups[cup].art = 0;
        cups[cup].ire = 0;

        // Amount owed in SKR, including liquidation penalty
        uint256 owe = rdiv(rmul(rmul(rue, axe), vox.par()), tag());

        if (owe > cups[cup].ink) {
            owe = cups[cup].ink;
        }

        skr.push(tap, owe);
        cups[cup].ink = sub(cups[cup].ink, owe);
    }

    //------------------------------------------------------------------

    function cage(uint fit_, uint jam) public payable note auth {
        require(!off && fit_ != 0);
        off = true;
        axe = RAY;
        gap = WAD;
        fit = fit_;         // ref per skr
        require(gem.transfer(tap, jam));
    }
    function flow() public payable note auth {
        require(off);
        out = true;
    }
}
