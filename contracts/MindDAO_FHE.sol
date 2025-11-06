pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MindDAO_FHE is ZamaEthereumConfig {
    struct MemberProfile {
        address memberAddress;
        euint32 encryptedExperience;
        uint256 publicTraits;
        uint256 timestamp;
        bool isVerified;
        uint32 decryptedExperience;
    }

    mapping(address => MemberProfile) public memberProfiles;
    address[] public memberAddresses;

    event ProfileCreated(address indexed member, uint256 timestamp);
    event ProfileVerified(address indexed member, uint32 decryptedValue);

    constructor() ZamaEthereumConfig() {
    }

    function createProfile(
        externalEuint32 encryptedExperience,
        bytes calldata inputProof,
        uint256 publicTraits
    ) external {
        require(memberProfiles[msg.sender].memberAddress == address(0), "Profile already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedExperience, inputProof)), "Invalid encrypted input");
        
        memberProfiles[msg.sender] = MemberProfile({
            memberAddress: msg.sender,
            encryptedExperience: FHE.fromExternal(encryptedExperience, inputProof),
            publicTraits: publicTraits,
            timestamp: block.timestamp,
            isVerified: false,
            decryptedExperience: 0
        });
        
        FHE.allowThis(memberProfiles[msg.sender].encryptedExperience);
        FHE.makePubliclyDecryptable(memberProfiles[msg.sender].encryptedExperience);
        
        memberAddresses.push(msg.sender);
        
        emit ProfileCreated(msg.sender, block.timestamp);
    }

    function verifyProfile(
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(memberProfiles[msg.sender].memberAddress != address(0), "Profile does not exist");
        require(!memberProfiles[msg.sender].isVerified, "Profile already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(memberProfiles[msg.sender].encryptedExperience);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        memberProfiles[msg.sender].decryptedExperience = decodedValue;
        memberProfiles[msg.sender].isVerified = true;
        
        emit ProfileVerified(msg.sender, decodedValue);
    }

    function getEncryptedExperience(address memberAddress) external view returns (euint32) {
        require(memberProfiles[memberAddress].memberAddress != address(0), "Profile does not exist");
        return memberProfiles[memberAddress].encryptedExperience;
    }

    function getProfile(address memberAddress) external view returns (
        uint256 publicTraits,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedExperience
    ) {
        require(memberProfiles[memberAddress].memberAddress != address(0), "Profile does not exist");
        MemberProfile storage profile = memberProfiles[memberAddress];
        
        return (
            profile.publicTraits,
            profile.timestamp,
            profile.isVerified,
            profile.decryptedExperience
        );
    }

    function getAllMemberAddresses() external view returns (address[] memory) {
        return memberAddresses;
    }

    function matchMembers() external view returns (address[] memory) {
        address[] memory matches = new address[](memberAddresses.length);
        uint256 matchCount = 0;

        for (uint256 i = 0; i < memberAddresses.length; i++) {
            MemberProfile storage profile1 = memberProfiles[memberAddresses[i]];
            if (!profile1.isVerified) continue;

            for (uint256 j = i + 1; j < memberAddresses.length; j++) {
                MemberProfile storage profile2 = memberProfiles[memberAddresses[j]];
                if (!profile2.isVerified) continue;

                if (_calculateSimilarity(profile1, profile2) > 75) {
                    matches[matchCount] = memberAddresses[i];
                    matchCount++;
                    matches[matchCount] = memberAddresses[j];
                    matchCount++;
                }
            }
        }

        assembly {
            mstore(matches, matchCount)
        }
        return matches;
    }

    function _calculateSimilarity(MemberProfile storage profile1, MemberProfile storage profile2) internal pure returns (uint256) {
        uint256 similarity = 0;
        uint256 maxSimilarity = 100;

        if (profile1.decryptedExperience == profile2.decryptedExperience) {
            similarity += 50;
        }

        uint256 traitSimilarity = _countMatchingBits(profile1.publicTraits, profile2.publicTraits);
        similarity += (traitSimilarity * 50) / 256;

        return (similarity * 100) / maxSimilarity;
    }

    function _countMatchingBits(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 xorResult = a ^ b;
        uint256 matchingBits = 0;

        while (xorResult > 0) {
            matchingBits += 1;
            xorResult &= xorResult - 1;
        }

        return 256 - matchingBits;
    }
}


